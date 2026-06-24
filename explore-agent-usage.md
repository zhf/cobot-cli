# Explore Agent Usage Guide

## Basic Usage

**Interactive mode:**
```bash
cobot --agent explore
```

**Non-interactive mode:**
```bash
cobot run --agent explore "find where request payloads are assembled"
```

**With structured output:**
```bash
cobot run --agent explore --output ndjson "find where request payloads are assembled"
```

## Key Features

The explore agent is designed for **parallel read-only codebase exploration** with automatic skill injection. It:

- Scans your codebase in parallel using multiple worker LLM calls
- Auto-loads relevant skills based on your prompt
- Supports adaptive mode that can skip the second round if confidence is high
- Validates cited paths to catch potential hallucinations
- Emits structured progress events when using `--output ndjson`

## Configuration Options

The explore agent has extensive configuration options available via `cobot config set`:

**LLM Model** (recommended: deepseek-v4-flash with thinking disabled):
```bash
cobot config set model deepseek-v4-flash
cobot config set explore.thinking.worker disabled
cobot config set explore.thinking.synthesis disabled
```

**Reranking** (requires DashScope API):
```bash
cobot config set explore.rerank.model qwen3-rerank
cobot config set explore.rerank.apiKey your_api_key
cobot config set explore.rerank.topN 32
cobot config set explore.rerank.perRole 8
cobot config set explore.rerank.timeoutMs 5000
cobot config set explore.rerank.instruct "Reorder these results by relevance to the query"
cobot config set explore.rerank.baseURL https://dashscope.aliyuncs.com/api/v1/services/rerank/models
```

**Adaptive mode** (skip round 2 on high confidence):
```bash
cobot config set explore.adaptive.minHighPriorityFiles 4
cobot config set explore.adaptive.minDeclarationEvidence 1
cobot config set explore.adaptive.maxLowSignalRatio 0.5
```

**Scanning behavior**:
```bash
cobot config set explore.scan.maxFiles 60000
cobot config set explore.scan.recentFirst true
cobot config set explore.scan.ignoreDirs "node_modules,dist"
cobot config set explore.scan.honorGitignore true
```

## When to Use

Use the explore agent when you need to:
- Understand codebase architecture
- Find where specific functionality is implemented
- Explore large codebases quickly with parallel processing
- Get structured progress for machine consumption

The explore agent is particularly useful for broad questions like "how does authentication work?" or "where are API endpoints defined?" as it can scan many files in parallel and synthesize a comprehensive answer.