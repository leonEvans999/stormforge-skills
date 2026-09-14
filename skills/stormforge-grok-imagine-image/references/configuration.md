# Configuration

The default configuration is `%USERPROFILE%\.grok\config.toml`. The skill selects the default model entry from `[models] default`, then reads its `base_url` and `api_key` fields. `OPENAI_BASE_URL` and `OPENAI_API_KEY` override those values when set.

The image model defaults to `xai/grok-imagine-image`. Use `--config` to provide a different Grok config for testing.
