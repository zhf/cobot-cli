import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult, createToolResponse } from './files.js';
import { glob } from 'glob';

const execAsync = promisify(exec);

/**
 * Convert documents between formats using pandoc
 */
export async function convertDocument(
  commandString: string
): Promise<ToolResult> {
  try {
    // Parse command string to extract input and output files
    const args = commandString.split(' ');
    const inputFileIndex = args.findIndex(arg => !arg.startsWith('-'));
    const outputFileIndex = args.findIndex((arg, index) => index > inputFileIndex && !arg.startsWith('-'));
    
    if (inputFileIndex === -1 || outputFileIndex === -1) {
      return createToolResponse(false, undefined, '', 'Error: Invalid command format. Expected: pandoc [options] input_file output_file');
    }

    const inputFile = args[inputFileIndex];
    const outputFile = args[outputFileIndex];

    // Check if input file exists
    const inputPath = path.resolve(inputFile);
    const exists = await fs.promises.access(inputPath).then(() => true).catch(() => false);
    if (!exists) {
      return createToolResponse(false, undefined, '', 'Error: Input file not found');
    }

    // Check if pandoc is available
    try {
      await execAsync('pandoc --version');
    } catch {
      return createToolResponse(false, undefined, '', 'Error: pandoc is not installed or not in PATH');
    }

    // Build pandock command
    const command = `pandoc ${commandString}`;

    const { stdout, stderr } = await execAsync(command);

    // Check if output file was created
    const outputPath = path.resolve(outputFile);
    const outputExists = await fs.promises.access(outputPath).then(() => true).catch(() => false);

    return createToolResponse(
      outputExists,
      `stdout: ${stdout}\nstderr: ${stderr}`,
      outputExists ? `Document converted successfully from ${inputFile} to ${outputFile}` : `Conversion completed but output file may not be where expected`,
    );
  } catch (error: any) {
    return createToolResponse(false, undefined, '', `Error: Failed to convert document - ${error.message}`);
  }
}

/**
 * Process a single image using ImageMagick
 */
export async function processImage(
  commandString: string
): Promise<ToolResult> {
  try {
    // Parse command string to extract input and output files
    const args = commandString.split(' ');
    const inputFileIndex = args.findIndex(arg => !arg.startsWith('-'));
    const outputFileIndex = args.findIndex((arg, index) => index > inputFileIndex && !arg.startsWith('-'));
    
    if (inputFileIndex === -1 || outputFileIndex === -1) {
      return createToolResponse(false, undefined, '', 'Error: Invalid command format. Expected: magick [options] input_file output_file');
    }

    const inputFile = args[inputFileIndex];
    const outputFile = args[outputFileIndex];

    // Check if input file exists
    const inputPath = path.resolve(inputFile);
    const exists = await fs.promises.access(inputPath).then(() => true).catch(() => false);
    if (!exists) {
      return createToolResponse(false, undefined, '', 'Error: Input image file not found');
    }

    // Check if magick is available
    try {
      await execAsync('magick --version');
    } catch {
      return createToolResponse(false, undefined, '', 'Error: ImageMagick (magick) is not installed or not in PATH');
    }

    // Build magick command
    const command = `magick ${commandString}`;

    const { stdout, stderr } = await execAsync(command);

    // Check if output file was created
    const outputPath = path.resolve(outputFile);
    const outputExists = await fs.promises.access(outputPath).then(() => true).catch(() => false);

    return createToolResponse(
      outputExists,
      `stdout: ${stdout}\nstderr: ${stderr}`,
      outputExists ? `Image processed successfully: ${inputFile} to ${outputFile}` : `Processing completed but output file may not be where expected`,
    );
  } catch (error: any) {
    return createToolResponse(false, undefined, '', `Error: Failed to process image - ${error.message}`);
  }
}

/**
 * Process multiple images using ImageMagick with batch operations
 */
export async function batchProcessImages(
  commandString: string
): Promise<ToolResult> {
  try {
    // Parse command string to extract input pattern and output directory
    const args = commandString.split(' ');
    const inputPatternIndex = args.findIndex(arg => !arg.startsWith('-'));
    const outputDirIndex = args.findIndex((arg, index) => index > inputPatternIndex && !arg.startsWith('-'));
    
    if (inputPatternIndex === -1 || outputDirIndex === -1) {
      return createToolResponse(false, undefined, '', 'Error: Invalid command format. Expected: magick [options] input_pattern output_dir');
    }

    const inputPattern = args[inputPatternIndex];
    const outputDir = args[outputDirIndex];

    // Check if magick is available
    try {
      await execAsync('magick --version');
    } catch {
      return createToolResponse(false, undefined, '', 'Error: ImageMagick (magick) is not installed or not in PATH');
    }

    // Create output directory if it doesn't exist
    const outputPath = path.resolve(outputDir);
    await fs.promises.mkdir(outputPath, { recursive: true });

    // Find matching files
    const files = await glob(inputPattern);
    
    if (files.length === 0) {
      return createToolResponse(false, undefined, '', 'Error: No files found matching the input pattern');
    }

    const results: string[] = [];
    const errors: string[] = [];

    // Process each file
    for (const file of files) {
      try {
        const fileName = path.basename(file, path.extname(file));
        const extension = 'png'; // Default extension
        const outputFile = path.join(outputPath, `${fileName}.${extension}`);

        // Build command for individual file processing
        const fileCommand = `${file} ${outputFile}`;
        const result = await processImage(fileCommand);

        if (result.success) {
          results.push(`${file} -> ${outputFile}`);
        } else {
          errors.push(`${file}: ${result.error}`);
        }
      } catch (error: any) {
        errors.push(`${file}: ${error.message}`);
      }
    }

    const success = errors.length === 0;
    const summary = `Batch processing completed: ${results.length} files processed successfully, ${errors.length} failed`;
    
    let details = summary;
    if (results.length > 0) {
      details += `\n\nSuccessfully processed:\n${results.slice(0, 10).join('\n')}`;
      if (results.length > 10) {
        details += `\n... and ${results.length - 10} more files`;
      }
    }
    
    if (errors.length > 0) {
      details += `\n\nErrors:\n${errors.slice(0, 10).join('\n')}`;
      if (errors.length > 10) {
        details += `\n... and ${errors.length - 10} more errors`;
      }
    }

    return createToolResponse(success, details, summary);
  } catch (error: any) {
    return createToolResponse(false, undefined, '', `Error: Failed to batch process images - ${error.message}`);
  }
}

/**
 * Process video and audio files using FFmpeg
 */
export async function processMedia(
  commandString: string
): Promise<ToolResult> {
  try {
    // Parse command string to extract input and output files
    const args = commandString.split(' ');
    const inputFileIndex = args.findIndex(arg => !arg.startsWith('-'));
    const outputFileIndex = args.findIndex((arg, index) => index > inputFileIndex && !arg.startsWith('-'));
    
    if (inputFileIndex === -1 || outputFileIndex === -1) {
      return createToolResponse(false, undefined, '', 'Error: Invalid command format. Expected: ffmpeg [options] input_file output_file');
    }

    const inputFile = args[inputFileIndex];
    const outputFile = args[outputFileIndex];

    // Check if input file exists
    const inputPath = path.resolve(inputFile);
    const exists = await fs.promises.access(inputPath).then(() => true).catch(() => false);
    if (!exists) {
      return createToolResponse(false, undefined, '', 'Error: Input media file not found');
    }

    // Check if ffmpeg is available
    try {
      await execAsync('ffmpeg -version');
    } catch {
      return createToolResponse(false, undefined, '', 'Error: FFmpeg is not installed or not in PATH');
    }

    // Build ffmpeg command
    const command = `ffmpeg ${commandString} -y`;

    const { stdout, stderr } = await execAsync(command);

    // Check if output file was created
    const outputPath = path.resolve(outputFile);
    const outputExists = await fs.promises.access(outputPath).then(() => true).catch(() => false);

    return createToolResponse(
      outputExists,
      `stdout: ${stdout}\nstderr: ${stderr}`,
      outputExists ? `Media processed successfully: ${inputFile} to ${outputFile}` : `Processing completed but output file may not be where expected`,
    );
  } catch (error: any) {
    return createToolResponse(false, undefined, '', `Error: Failed to process media - ${error.message}`);
  }
}