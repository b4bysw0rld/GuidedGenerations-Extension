# GitHub Copilot Instructions for GuidedGenerations-Extension

## Project context
- This is a SillyTavern browser extension living under `scripts/extensions/third-party/GuidedGenerations-Extension` and loaded via `manifest.json` → `index.js`.
- `index.js` is the main entry point; it wires into SillyTavern via `getContext`, `eventSource`, `extension_settings`, and jQuery `$(document).ready`.
- The extension adds UI around the send form (`#send_form`, `#nonQRFormItems`) plus two dropdown menus:
  - GG Tools (simple send, input recovery, edit intros, corrections, spellchecker, clear input, undo/revert, help).
  - Persistent Guides (situational/thinking/clothes/state/rules/custom/custom auto/fun, and tools like show/edit/flush guides, stat tracker).
- Core user-facing actions are implemented as small modules in `scripts/` and `scripts/persistentGuides/`, imported and orchestrated by `index.js`.

## Architecture and patterns
- **Main orchestrator**: `index.js`
  - Owns `extensionName`, `defaultSettings`, debug helpers, settings load/migration, and all button/menu creation.
  - Uses `updateExtensionButtons()` to rebuild the entire button row based on `extension_settings[extensionName]` flags.
  - Integrates the QR bar (`#qr--bar`) into a dedicated container, controlled by `integrateQrBar()` plus mutation observers.
  - Listens to SillyTavern events (`context.eventTypes.*`, `eventSource.on('GENERATION_AFTER_COMMANDS', …)`) to auto-trigger guides and maintain a persistent guide counter badge.
- **Guide/actions modules** (examples):
  - `scripts/guidedResponse.js`, `guidedSwipe.js`, `guidedContinue.js`, `guidedImpersonate*.js`, `simpleSend.js`, `inputRecovery.js` implement single responsibilities and are called directly from `index.js`.
  - `scripts/persistentGuides/*.js` implement content injections and helper tools, usually exported as `default` and invoked via dynamic import from menus.
  - `scripts/persistentGuides/guideExports.js` centralizes higher-level guide utilities (e.g. `corrections`, `spellchecker`, tracker helpers, profile/preset helpers).
- **Settings & UI panel**:
  - `scripts/settingsPanel.js` plus `settings.html`/`style.css` define the extension settings panel rendered via `renderExtensionTemplateAsync`.
  - Settings keys live in `defaultSettings` inside `index.js`. Any new configurable behavior **must** be added there, then wired into `updateSettingsUI()` and the settings template.
  - Inputs in the settings panel use the `gg-setting-input` class and `name` attribute that match keys in `defaultSettings`/`extension_settings[extensionName]`.

## SillyTavern integration
- Use `getContext()` from `extensions.js` instead of trying to import SillyTavern internals directly.
- For events, use `context.eventSource.makeLast(eventType, handler)` for high-level ST events and `eventSource.on('GENERATION_AFTER_COMMANDS', handler)` for low-level generation hooks.
- To run slash commands or inject content, use `context.executeSlashCommandsWithOptions()`; do **not** manually mutate chat state.
- Presets and profiles:
  - Use `getPresetManager(apiId)` from `preset-manager.js` to read/save presets.
  - For profile-aware behavior, use helpers from `scripts/utils/presetUtils.js` and `scripts/persistentGuides/guideExports.js` (e.g. `getProfileList`, `getProfileApiType`, `getPresetsForApiType`).

## Conventions for new code
- Prefer **one module per feature** under:
  - `scripts/` for send-button and simple tools.
  - `scripts/persistentGuides/` for anything that writes persistent injections or metadata.
  - `scripts/tools/` for small, direct input utilities (clear, spellcheck popup, etc.).
- Export a single default function for guide/tool modules to keep dynamic imports simple (`const mod = await import('…'); await mod.default();`).
- When adding settings:
  - Add defaults in `defaultSettings` (including prompt text / depth / raw flags when applicable).
  - Add UI fields in `settings.html` with matching `id` (usually `gg_<key>`) and `name` attributes.
  - Ensure `updateSettingsUI()` and `handleSettingChange()` in `index.js` can handle the new field type.
- When adding buttons/menu items:
  - Use the shared creators in `updateExtensionButtons()` for action buttons or the `createGuideItem` helper for persistent guides.
  - Always attach click handlers via JS, not inline HTML attributes.
  - Keep all IDs unique and consistent with existing naming patterns (`gg_*` for buttons, `pg_*` for persistent-guide UI).

## Debugging and development workflows
- Enable `debugMode` in the extension settings to capture debug logs:
  - Use `debugLog`, `debugWarn`, `debugError` from `index.js` instead of raw `console.log` where possible.
  - Inspect captured logs via `getDebugMessages()` / `getDebugMessagesAsText()` if needed.
- When modifying auto-guides or trackers that hook `GENERATION_AFTER_COMMANDS`:
  - Respect the existing guard conditions: skip when `dryRun` or `generateArgsObject?.signal` is present.
  - Preserve the logic that temporarily flushes and then restores the ephemeral `instruct` injection.
- For UI issues around the send bar or QR bar, review `updateExtensionButtons()`, `integrateQRBar()`, `startQRBarIntegration()`, and `setupQRMutationObserver()` first.

## Things to avoid
- Do **not** introduce new hard dependencies on global ST internals beyond those already used (`getContext`, `eventSource`, `SillyTavern.libs.lodash`, preset manager APIs).
- Do not move or rename core files (`index.js`, `manifest.json`, `GGSytemPrompt.json`) without updating preset installation logic.
- Avoid inlining large prompt text directly into new scripts; keep prompts in `defaultSettings` so users can override them via settings.
