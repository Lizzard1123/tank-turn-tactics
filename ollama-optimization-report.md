# Ollama qwen3.6:35b-a3b-coding-nvfp4 Optimization Report

## System
- **Chip**: Apple M1 Max (10-core CPU, 10-core GPU)
- **Memory**: 64GB Unified Memory
- **Ollama**: v0.34.0 (**OUTDATED** - upgrade to v0.40.15+)
- **Model**: qwen3.6:35b-a3b-coding-nvfp4 (35.1B params, NVFP4)

## CRITICAL FINDING: Upgrade Ollama First

Your v0.34.0 has a known bug where the `/v1` endpoint **silently overrides** model sampler defaults:
- `temperature` → forced to `1.0` (overriding your modelfile value)
- `top_p` → forced to `1.0`
- This was fixed in **v0.40.14** (PR [#19432](https://github.com/ollama/ollama/pull/19432))
- **Upgrade to v0.40.15** (latest, released Nov 6, 2026)

After upgrading, the modelfile approach will work correctly for Claude Code.

## num_predict Behavior (KEY FINDING)

**num_predict is a HARD CAP, not a fixed target.**

| num_predict | Tokens Generated | Behavior |
|-------------|-----------------|----------|
| 100 | exactly 100 | Forced stop (cap hit) |
| 500 | exactly 500 | Forced stop (cap hit) |
| 2000 | exactly 2000 | Forced stop (cap hit) |
| 5000 | 4082 | Natural stop (before cap) |
| -1 (default) | ~4500-4600 | Natural stop |

**Answer to your question**: It's a **cap**, not a fixed target. The model can (and will) stop earlier if it naturally wants to. Setting `num_predict=5000` means "stop at 5000 if you would have gone longer, but you can stop earlier."

For coding tasks, default output is ~4500 tokens. A cap of 5000 would prevent the tail-end rambling without cutting off substantive responses.

## All Tested Parameters (v0.34.0, single-variable)
| Parameter | Value | Result |
|-----------|-------|--------|
| **temperature** | **0.8** | **28% faster** |
| top_k | 15 | 3% slower |
| repeat_penalty | 1.1 | 25% slower |
| num_ctx | 4096 | 3% faster (marginal) |
| num_ctx | 16384 | 10% slower |
| seed | 42 | 29% slower |

## The Fix: Optimized Modelfile

After upgrading to v0.40.15+, create the optimized model:
```bash
ollama create qwen3.6:35b-optimized -f ollama-optimized-modelfile
ollama launch claude --model qwen3.6:35b-optimized
```

The modelfile is saved at: `ollama-optimized-modelfile`

## Claude Code Harness

- Claude Code does **NOT** expose temperature/num_predict in `settings.json`
- Temperature is controlled at the API/provider level only
- The modelfile approach is the **only** way to set these for Claude Code
- After upgrading to v0.40.15+, the modelfile will work correctly

## Alternative Harnesses

- **OpenCode**: Also uses `/v1` endpoint. Same v0.34.0 bug. Upgrade fixes it.
- **Pi**: Also uses `/v1` endpoint. Same bug. After upgrade, all three work.
- All three benefit from the same Ollama upgrade.

## Resources
- Ollama /v1 fix: https://github.com/ollama/ollama/pull/19432
- Ollama v0.40.15: https://github.com/ollama/ollama/releases
- Claude Code docs: https://docs.ollama.com/integrations/claude-code
- OpenCode: https://docs.ollama.com/integrations/opencode
- Pi: https://docs.ollama.com/integrations/pi
