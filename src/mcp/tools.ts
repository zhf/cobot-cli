import type { ToolSchema } from '../tools/schemas/index.js';
import type { ToolResult } from '../tools/files.js';
import { getMCPManager, type MCPTool } from './client.js';

export interface VisionImagePayload {
  mimeType: string;
  base64: string;
  width?: number;
  height?: number;
}

export function convertMCPToolToSchema(mcpTool: MCPTool): ToolSchema {
  const parameters = mcpTool.inputSchema && typeof mcpTool.inputSchema === 'object'
    ? mcpTool.inputSchema
    : { type: 'object', properties: {} };

  return {
    type: 'function',
    function: {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: {
        type: 'object',
        properties: (parameters.properties as Record<string, unknown>) || {},
        required: Array.isArray(parameters.required) ? parameters.required as string[] : [],
      },
    },
  };
}

export function getMCPToolSchemas(): ToolSchema[] {
  return getMCPManager().getTools().map(convertMCPToolToSchema);
}

export function isMCPToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}

export function isChromaSnapshotTool(toolName: string): boolean {
  return toolName === 'mcp__chroma__get_snapshot' || toolName.endsWith('__get_snapshot');
}

function compactSnapshotPayload(rawText: string): { compact: Record<string, unknown>; vision?: VisionImagePayload } {
  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const base64 = typeof parsed.base64 === 'string' ? parsed.base64 : undefined;
    const mimeType = typeof parsed.mimeType === 'string' ? parsed.mimeType : 'image/jpeg';
    const compact: Record<string, unknown> = {
      mimeType,
      width: parsed.width,
      height: parsed.height,
      original: parsed.original,
      base64Length: base64?.length ?? 0,
      note: 'Full image attached as a multimodal message for vision.',
    };
    if (!base64) {
      return { compact: parsed };
    }
    return {
      compact,
      vision: {
        mimeType,
        base64,
        width: typeof parsed.width === 'number' ? parsed.width : undefined,
        height: typeof parsed.height === 'number' ? parsed.height : undefined,
      },
    };
  } catch {
    return { compact: { raw: rawText.slice(0, 500) } };
  }
}

export async function executeMCPTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<ToolResult & { visionImage?: VisionImagePayload }> {
  try {
    const manager = getMCPManager();
    const result = await manager.callTool(toolName, toolArgs);

    if (result.isError) {
      const errorText = result.content
        ?.map((item) => (item.type === 'text' ? item.text : String(item)))
        .join('\n');
      return {
        success: false,
        error: errorText || 'MCP tool error',
      };
    }

    const output = (result.content || [])
      .map((item) => {
        if (item.type === 'text') {
          return item.text;
        }
        return JSON.stringify(item);
      })
      .join('\n');

    if (isChromaSnapshotTool(toolName) && output) {
      const { compact, vision } = compactSnapshotPayload(output);
      return {
        success: true,
        content: compact,
        message: 'Snapshot captured for vision',
        visionImage: vision,
      };
    }

    return {
      success: true,
      content: output || 'Success',
      message: output || 'Success',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `MCP tool execution error: ${message}`,
    };
  }
}
