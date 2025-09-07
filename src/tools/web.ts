import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { createFile } from './files.js';
import { ToolResult, createToolResponse } from './files.js';

// Load environment variables from .env file
config();

/**
 * Generate a complete HTML file with embedded CSS and JavaScript based on a prompt
 */
export async function createWebPage(
  prompt: string,
  filePath: string,
  style: string = 'modern',
  colorScheme: string = 'light',
  overwrite: boolean = false
): Promise<ToolResult> {
  try {
    // Check if file exists and handle overwrite
    const resolvedPath = path.resolve(filePath);
    const exists = await fs.promises.access(resolvedPath).then(() => true).catch(() => false);
    
    if (exists && !overwrite) {
      return createToolResponse(false, undefined, '', 'Error: File already exists, use overwrite=true');
    }

    // Get frontend OpenAI config from environment variables
    const apiKey = process.env.FRONTEND_OPENAI_API_KEY;
    const baseUrl = process.env.FRONTEND_OPENAI_BASE_URL;
    const model = process.env.FRONTEND_MODEL;

    if (!apiKey) {
      return createToolResponse(false, undefined, '', 'Error: FRONTEND_OPENAI_API_KEY environment variable not set');
    }

    if (!model) {
      return createToolResponse(false, undefined, '', 'Error: FRONTEND_MODEL environment variable not set');
    }

    // Initialize OpenAI client with frontend config
    const openaiConfig: any = { apiKey };
    if (baseUrl) {
      openaiConfig.baseURL = baseUrl;
    }
    const openai = new OpenAI(openaiConfig);

    // Create the system prompt for web page generation
    const systemPrompt = `You are an expert web developer who creates complete, standalone HTML files. 

Generate a complete HTML file with the following requirements:
1. Include all CSS within <style> tags in the <head>
2. Include all JavaScript within <script> tags before the closing </body>
3. Make it responsive and mobile-friendly
4. Use semantic HTML5 elements
5. Include appropriate meta tags
6. Add hover effects and smooth transitions
7. Make it visually appealing with the specified style and color scheme
8. Ensure all interactive elements are functional
9. Use modern CSS features like flexbox/grid
10. Add a subtle animation or micro-interaction

Style preference: ${style}
Color scheme: ${colorScheme}

Return ONLY the complete HTML code (no explanations, no markdown code blocks).`;

    // Generate the web page using OpenAI
    const completion = await openai.chat.completions.create({
      model, // Use model from environment variable
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const htmlContent = completion.choices[0]?.message?.content;
    
    if (!htmlContent) {
      return createToolResponse(false, undefined, '', 'Error: Failed to generate web page content');
    }

    // Clean up the response - remove any markdown code block formatting if present
    let cleanHtml = htmlContent;
    if (htmlContent.includes('```html')) {
      cleanHtml = htmlContent.replace(/```html\n?/g, '').replace(/```\n?$/g, '').trim();
    }

    // Basic validation that it's proper HTML
    if (!cleanHtml.includes('<!DOCTYPE html') && !cleanHtml.includes('<html')) {
      return createToolResponse(false, undefined, '', 'Error: Generated content is not valid HTML');
    }

    // Write the HTML file
    const result = await createFile(filePath, cleanHtml, 'file', overwrite);
    
    if (result.success) {
      return createToolResponse(true, { path: filePath, size: cleanHtml.length }, `Created web page: ${filePath}`);
    } else {
      return result;
    }

  } catch (error) {
    if (error instanceof Error) {
      return createToolResponse(false, undefined, '', `Error: Failed to create web page - ${error.message}`);
    }
    return createToolResponse(false, undefined, '', 'Error: Failed to create web page');
  }
}