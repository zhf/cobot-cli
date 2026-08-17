import { Command } from 'commander';
import chalk from 'chalk';
import {
  addMCPServer,
  removeMCPServer,
  loadMCPConfig,
  listSuggestedMCPServers,
  PREDEFINED_SERVERS,
} from '../mcp/config.js';
import { getMCPManager, type MCPServerConfig } from '../mcp/client.js';

function parseKeyValuePairs(pairs: string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs || []) {
    const [key, ...rest] = pair.split('=');
    if (key && rest.length > 0) {
      result[key] = rest.join('=');
    }
  }
  return result;
}

export function createMCPCommand(): Command {
  const mcpCommand = new Command('mcp');
  mcpCommand.description('Manage MCP (Model Context Protocol) servers');

  mcpCommand
    .command('suggest')
    .description('List suggested MCP servers (including Chroma)')
    .action(() => {
      const suggestions = listSuggestedMCPServers();
      if (suggestions.length === 0) {
        console.log(chalk.yellow('No suggested MCP servers'));
        return;
      }

      console.log(chalk.bold('Suggested MCP servers:'));
      console.log();
      for (const suggestion of suggestions) {
        const status = suggestion.available
          ? chalk.green('available')
          : chalk.red('binary missing');
        console.log(`${chalk.bold(suggestion.name)} [${status}]`);
        console.log(`  ${suggestion.description}`);
        console.log(`  Command: ${suggestion.commandPath}`);
        console.log(`  Install: cobot mcp add ${suggestion.name}`);
        console.log();
      }
    });

  mcpCommand
    .command('add <name>')
    .description('Add an MCP server (use a suggested name, or pass --command)')
    .option('-t, --transport <type>', 'Transport type (stdio)', 'stdio')
    .option('-c, --command <command>', 'Command to run the server (stdio)')
    .option('-a, --args [args...]', 'Arguments for the server command', [])
    .option('-e, --env [env...]', 'Environment variables (key=value)', [])
    .action(async (name: string, options: {
      transport: string;
      command?: string;
      args?: string[];
      env?: string[];
    }) => {
      try {
        let config: MCPServerConfig;

        if (PREDEFINED_SERVERS[name] && !options.command) {
          config = PREDEFINED_SERVERS[name];
          addMCPServer(config);
          console.log(chalk.green(`✓ Added suggested MCP server: ${name}`));
        } else {
          const transportType = options.transport.toLowerCase();
          if (transportType !== 'stdio') {
            console.error(chalk.red('Error: Only stdio transport is supported'));
            process.exit(1);
          }
          if (!options.command) {
            console.error(chalk.red('Error: --command is required for custom servers (or use a suggested name)'));
            process.exit(1);
          }

          config = {
            name,
            transport: {
              type: 'stdio',
              command: options.command,
              args: options.args || [],
              env: parseKeyValuePairs(options.env),
            },
          };
          addMCPServer(config);
          console.log(chalk.green(`✓ Added MCP server: ${name}`));
        }

        const manager = getMCPManager();
        await manager.addServer(config);
        console.log(chalk.green(`✓ Connected to MCP server: ${name}`));

        const tools = manager.getTools().filter((tool) => tool.serverName === name);
        console.log(chalk.blue(`  Available tools: ${tools.length}`));
        for (const tool of tools) {
          const displayName = tool.name.replace(`mcp__${name}__`, '');
          console.log(`    - ${displayName}`);
        }

        // Disconnect so the CLI can exit; servers reconnect on agent runs.
        await manager.removeServer(name);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error adding MCP server: ${message}`));
        process.exit(1);
      }
    });

  mcpCommand
    .command('remove <name>')
    .description('Remove an MCP server')
    .action(async (name: string) => {
      try {
        const manager = getMCPManager();
        if (manager.getServers().includes(name)) {
          await manager.removeServer(name);
        }
        removeMCPServer(name);
        console.log(chalk.green(`✓ Removed MCP server: ${name}`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error removing MCP server: ${message}`));
        process.exit(1);
      }
    });

  mcpCommand
    .command('list')
    .description('List configured MCP servers')
    .action(() => {
      const config = loadMCPConfig();
      const manager = getMCPManager();

      if (config.servers.length === 0) {
        console.log(chalk.yellow('No MCP servers configured'));
        console.log(chalk.dim('Try: cobot mcp suggest'));
        return;
      }

      console.log(chalk.bold('Configured MCP servers:'));
      console.log();

      for (const server of config.servers) {
        const isConnected = manager.getServers().includes(server.name);
        const status = isConnected
          ? chalk.green('✓ Connected')
          : chalk.yellow('○ Not connected (will connect on next agent run)');

        console.log(`${chalk.bold(server.name)}: ${status}`);
        if (server.transport?.type === 'stdio') {
          console.log(`  Command: ${server.transport.command} ${(server.transport.args || []).join(' ')}`);
        }

        if (isConnected) {
          const tools = manager.getTools().filter((tool) => tool.serverName === server.name);
          console.log(`  Tools: ${tools.length}`);
          for (const tool of tools) {
            const displayName = tool.name.replace(`mcp__${server.name}__`, '');
            console.log(`    - ${displayName}: ${tool.description}`);
          }
        }
        console.log();
      }
    });

  mcpCommand
    .command('test <name>')
    .description('Test connection to an MCP server and list tools')
    .action(async (name: string) => {
      try {
        const config = loadMCPConfig();
        const serverConfig = config.servers.find((server) => server.name === name)
          || PREDEFINED_SERVERS[name];

        if (!serverConfig) {
          console.error(chalk.red(`Server ${name} not found. Try: cobot mcp suggest`));
          process.exit(1);
        }

        console.log(chalk.blue(`Testing connection to ${name}...`));
        const manager = getMCPManager();
        await manager.addServer(serverConfig);

        const tools = manager.getTools().filter((tool) => tool.serverName === name);
        console.log(chalk.green(`✓ Successfully connected to ${name}`));
        console.log(chalk.blue(`  Available tools: ${tools.length}`));
        for (const tool of tools) {
          const displayName = tool.name.replace(`mcp__${name}__`, '');
          console.log(`    - ${displayName}: ${tool.description}`);
        }

        await manager.removeServer(name);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`✗ Failed to connect to ${name}: ${message}`));
        process.exit(1);
      }
    });

  mcpCommand
    .command('call <server> <tool>')
    .description('Call an MCP tool (JSON args via --args)')
    .option('--args <json>', 'JSON object of tool arguments', '{}')
    .action(async (server: string, tool: string, options: { args: string }) => {
      try {
        const config = loadMCPConfig();
        const serverConfig = config.servers.find((entry) => entry.name === server)
          || PREDEFINED_SERVERS[server];

        if (!serverConfig) {
          console.error(chalk.red(`Server ${server} not found`));
          process.exit(1);
        }

        let toolArgs: Record<string, unknown>;
        try {
          toolArgs = JSON.parse(options.args);
        } catch {
          console.error(chalk.red('Error: --args must be valid JSON'));
          process.exit(1);
        }

        const manager = getMCPManager();
        await manager.addServer(serverConfig);

        const toolName = `mcp__${server}__${tool}`;
        const result = await manager.callTool(toolName, toolArgs);
        const text = (result.content || [])
          .map((item) => (item.type === 'text' ? item.text : JSON.stringify(item)))
          .join('\n');

        if (result.isError) {
          console.error(text || 'MCP tool error');
          process.exit(1);
        }

        console.log(text);
        await manager.removeServer(server);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error calling tool: ${message}`));
        process.exit(1);
      }
    });

  return mcpCommand;
}
