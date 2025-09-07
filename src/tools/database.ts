import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult, createToolResponse } from './files.js';
import http from 'http';
import { URLSearchParams } from 'url';

const execAsync = promisify(exec);

/**
 * Execute ClickHouse query via HTTP interface using URL parameters (like curl example)
 */
async function executeClickHouseHTTP(
  host: string,
  port: number,
  query: string,
  database: string = 'default',
  user: string = 'default',
  password?: string,
  format: string = 'JSON',
  timeout: number = 30
): Promise<any> {
  return new Promise((resolve, reject) => {
    // Build URL with query parameters like the curl example
    const params = new URLSearchParams();
    params.append('query', query);
    params.append('default_format', format);
    params.append('database', database);
    
    const auth = password ? `${user}:${password}@` : '';
    const url = `http://${auth}${host}:${port}/?${params.toString()}`;
    
    const options: any = {
      hostname: host,
      port: port,
      path: `/?${params.toString()}`,
      method: 'GET',
      timeout: timeout * 1000,
    };

    // Add basic auth header if password is provided
    if (password) {
      const authString = Buffer.from(`${user}:${password}`).toString('base64');
      options.headers = {
        'Authorization': `Basic ${authString}`
      };
    }

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            if (format === 'JSON') {
              resolve(JSON.parse(data));
            } else {
              resolve({ data: data });
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error instanceof Error ? error.message : String(error)}`));
          }
        } else {
          reject(new Error(`ClickHouse error (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', (error: unknown) => {
      reject(new Error(`Connection error: ${error instanceof Error ? error.message : String(error)}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Get ClickHouse database schema
 */
export async function getClickHouseSchema(
  host: string = 'localhost',
  port: number = 8123,
  database: string = 'default',
  user: string = 'default',
  password?: string,
  table?: string,
  includeSampleData: boolean = false,
  sampleLimit: number = 5
): Promise<ToolResult> {
  try {
    // Test connection first
    try {
      await executeClickHouseHTTP(host, port, 'SELECT 1', database || 'default', user, password, 'JSON', 10);
    } catch (error) {
      return createToolResponse(false, undefined, '', `Error: Cannot connect to ClickHouse - ${error instanceof Error ? error.message : String(error)}`);
    }

    const result: any = {
      host,
      port,
      database: database || 'all',
      tables: [],
      databases: [],
    };

    // Get all databases if no specific database is specified
    if (!database) {
      try {
        const dbQuery = 'SHOW DATABASES';
        const dbResult = await executeClickHouseHTTP(host, port, dbQuery, 'default', user, password, 'JSON', 10);
        result.databases = dbResult.data || [];
      } catch (error) {
        return createToolResponse(false, undefined, '', `Error: Failed to get databases - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Get tables
    const targetDatabase = database || 'default';
    let tablesQuery = `SHOW TABLES FROM ${targetDatabase}`;
    
    if (table) {
      tablesQuery = `SHOW TABLES FROM ${targetDatabase} LIKE '${table}'`;
    }

    try {
      const tablesResult = await executeClickHouseHTTP(host, port, tablesQuery, targetDatabase, user, password, 'JSON', 10);
      const tables = tablesResult.data || [];

      for (const tableInfo of tables) {
        const tableName = typeof tableInfo === 'string' ? tableInfo : tableInfo.name;
        
        // Get table schema
        const schemaQuery = `DESCRIBE TABLE ${targetDatabase}.${tableName}`;
        const schemaResult = await executeClickHouseHTTP(host, port, schemaQuery, targetDatabase, user, password, 'JSON', 10);
        
        const tableDetails: any = {
          name: tableName,
          database: targetDatabase,
          columns: schemaResult.data || [],
          sample_data: [],
        };

        // Get sample data if requested
        if (includeSampleData) {
          try {
            const sampleQuery = `SELECT * FROM ${targetDatabase}.${tableName} LIMIT ${sampleLimit}`;
            const sampleResult = await executeClickHouseHTTP(host, port, sampleQuery, targetDatabase, user, password, 'JSON', 10);
            tableDetails.sample_data = sampleResult.data || [];
          } catch (error) {
            // Don't fail if sample data query fails
            tableDetails.sample_data = [];
          }
        }

        // Get table engine and other metadata
        try {
          const metadataQuery = `SELECT name, engine, total_rows FROM system.tables WHERE database = '${targetDatabase}' AND name = '${tableName}'`;
          const metadataResult = await executeClickHouseHTTP(host, port, metadataQuery, 'system', user, password, 'JSON', 10);
          const metadata = metadataResult.data?.[0] || {};
          tableDetails.engine = metadata.engine || 'Unknown';
          tableDetails.total_rows = metadata.total_rows || 0;
        } catch (error) {
          tableDetails.engine = 'Unknown';
          tableDetails.total_rows = 0;
        }

        result.tables.push(tableDetails);
      }
    } catch (error) {
      return createToolResponse(false, undefined, '', `Error: Failed to get tables - ${error instanceof Error ? error.message : String(error)}`);
    }

    // Format the output for better readability
    let formattedOutput = `ClickHouse Schema Analysis\n`;
    formattedOutput += `========================\n`;
    formattedOutput += `Host: ${host}:${port}\n`;
    formattedOutput += `Database: ${targetDatabase}\n`;
    formattedOutput += `Tables found: ${result.tables.length}\n\n`;

    if (result.databases.length > 0) {
      formattedOutput += `Available databases:\n`;
      result.databases.forEach((db: string) => {
        formattedOutput += `  - ${db}\n`;
      });
      formattedOutput += `\n`;
    }

    result.tables.forEach((table: any) => {
      formattedOutput += `Table: ${table.name}\n`;
      formattedOutput += `  Database: ${table.database}\n`;
      formattedOutput += `  Engine: ${table.engine}\n`;
      formattedOutput += `  Total rows: ${table.total_rows}\n`;
      formattedOutput += `  Columns:\n`;
      
      table.columns.forEach((col: any) => {
        formattedOutput += `    - ${col.name}: ${col.type}`;
        if (col.default_type) {
          formattedOutput += ` (default: ${col.default_type})`;
        }
        formattedOutput += `\n`;
      });

      if (includeSampleData && table.sample_data.length > 0) {
        formattedOutput += `  Sample data (${table.sample_data.length} rows):\n`;
        table.sample_data.forEach((row: any, index: number) => {
          formattedOutput += `    Row ${index + 1}: ${JSON.stringify(row)}\n`;
        });
      }
      formattedOutput += `\n`;
    });

    return createToolResponse(
      true,
      formattedOutput,
      `Successfully retrieved schema for ${result.tables.length} tables from ClickHouse`
    );
  } catch (error: any) {
    return createToolResponse(false, undefined, '', `Error: Failed to get ClickHouse schema - ${error.message}`);
  }
}

/**
 * Execute ClickHouse query
 */
export async function executeClickHouseQuery(
  query: string,
  host: string = 'localhost',
  port: number = 8123,
  database: string = 'default',
  user: string = 'default',
  password?: string,
  format: string = 'JSON',
  maxRows: number = 1000,
  timeout: number = 30
): Promise<ToolResult> {
  try {
    // Basic query validation
    const trimmedQuery = query.trim().toUpperCase();
    
    // Prevent dangerous operations
    const dangerousPatterns = [
      'DROP TABLE',
      'DROP DATABASE',
      'TRUNCATE TABLE',
      'ALTER TABLE',
      'CREATE TABLE',
      'DELETE FROM',
      'UPDATE'
    ];

    const isDangerous = dangerousPatterns.some(pattern => 
      trimmedQuery.includes(pattern) && !trimmedQuery.includes('SELECT')
    );

    if (isDangerous) {
      return createToolResponse(false, undefined, '', 'Error: Potentially dangerous query detected. Use DDL operations with caution.');
    }

    // Add LIMIT clause if not present and it's a SELECT query
    let finalQuery = query;
    if (trimmedQuery.startsWith('SELECT') && !trimmedQuery.includes('LIMIT') && !trimmedQuery.includes('TOP')) {
      finalQuery = `${query} LIMIT ${maxRows}`;
    }

    // Execute query
    const result = await executeClickHouseHTTP(host, port, finalQuery, database, user, password, format, timeout);

    // Format the output
    let formattedOutput = `ClickHouse Query Results\n`;
    formattedOutput += `======================\n`;
    formattedOutput += `Query: ${finalQuery}\n`;
    formattedOutput += `Database: ${database}\n`;
    formattedOutput += `Host: ${host}:${port}\n\n`;

    if (format === 'JSON' && result.data) {
      const rows = Array.isArray(result.data) ? result.data : [result.data];
      formattedOutput += `Rows returned: ${rows.length}\n\n`;
      
      if (rows.length > 0) {
        // Show column headers
        const columns = Object.keys(rows[0]);
        formattedOutput += `Columns: ${columns.join(', ')}\n\n`;
        
        // Show data
        rows.forEach((row: any, index: number) => {
          formattedOutput += `Row ${index + 1}: ${JSON.stringify(row)}\n`;
        });
        
        if (rows.length === maxRows) {
          formattedOutput += `\nNote: Results limited to ${maxRows} rows. Use a higher max_rows parameter for more results.\n`;
        }
      } else {
        formattedOutput += `No rows returned.\n`;
      }
    } else {
      formattedOutput += `Result: ${JSON.stringify(result)}\n`;
    }

    return createToolResponse(
      true,
      formattedOutput,
      `Query executed successfully on ${database} database`
    );
  } catch (error: any) {
    return createToolResponse(false, undefined, '', `Error: Failed to execute ClickHouse query - ${error.message}`);
  }
}