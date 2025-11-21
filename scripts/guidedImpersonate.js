// scripts/guidedImpersonate.js
import { getContext, extension_settings, extensionName, debugLog, handleSwitching, getPreviousImpersonateInput, setPreviousImpersonateInput, getLastImpersonateResult, setLastImpersonateResult, consumeImpersonateRestoreFallback } from './persistentGuides/guideExports.js'; // Import from central hub

let isGuidedImpersonateRunning = false;

const PLACEHOLDER = '{{input}}';

function fillPrompt(template = '', userText = '') {
    if (!template.includes(PLACEHOLDER)) {
        return template || userText;
    }
    return template.split(PLACEHOLDER).join(userText);
}

function sanitizeForSTScript(text = '') {
    return text
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '\\|');
}

const guidedImpersonate = async () => {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error('[GuidedGenerations] Textarea #send_textarea not found.');
        return;
    }
    const currentInputText = textarea.value;
    const lastGeneratedText = getLastImpersonateResult(); // Use getter

    // Check if the current input matches the last generated text
    if (lastGeneratedText && currentInputText === lastGeneratedText) {
        const fallback = consumeImpersonateRestoreFallback();
        textarea.value = fallback || getPreviousImpersonateInput(); // Use getter / fallback
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return; // Restoration done, exit
    }

    if (isGuidedImpersonateRunning) {
        debugLog('[Impersonate-1st] Execution skipped because another run is in progress.');
        return;
    }
    isGuidedImpersonateRunning = true;

    // --- If not restoring, proceed with impersonation ---
    setPreviousImpersonateInput(currentInputText); // Use setter

    // Handle profile and preset switching using unified utility
    const profileKey = 'profileImpersonate1st';
    const presetKey = 'presetImpersonate1st';
    const profileValue = extension_settings[extensionName]?.[profileKey] ?? '';
    const presetValue = extension_settings[extensionName]?.[presetKey] ?? '';
    
    // Debug: Log the exact values being retrieved
    debugLog(`[Impersonate-1st] Profile key: "${profileKey}"`);
    debugLog(`[Impersonate-1st] Preset key: "${presetKey}"`);
    debugLog(`[Impersonate-1st] Profile value from settings: "${profileValue}"`);
    debugLog(`[Impersonate-1st] Preset value from settings: "${presetValue}"`);
    debugLog(`[Impersonate-1st] All profile settings:`, Object.keys(extension_settings[extensionName] || {}).filter(key => key.startsWith('profile')));
    
    debugLog(`[Impersonate-1st] Using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);
    
    const { switch: switchProfileAndPreset, restore } = await handleSwitching(profileValue, presetValue);

    // Use user-defined impersonate prompt override
    const promptTemplate = extension_settings[extensionName]?.promptImpersonate1st ?? '';
    const filledPrompt = fillPrompt(promptTemplate, currentInputText);
    const sanitizedPrompt = sanitizeForSTScript(filledPrompt);

    // Build STScript without preset switching
    const stscriptCommand = `/impersonate await=true ${sanitizedPrompt} |`;
    const fullScript = `// Impersonate guide|\n${stscriptCommand}`;

    try {
        const context = getContext();
        if (typeof context.executeSlashCommandsWithOptions === 'function') {
            debugLog('[Impersonate-1st] About to switch profile and preset...');
            
            // Switch profile and preset before executing
            await switchProfileAndPreset();
            
            debugLog('[Impersonate-1st] Profile and preset switch complete, about to execute STScript...');
            
            // Execute the command and wait for it to complete
            await context.executeSlashCommandsWithOptions(fullScript); 
            
            debugLog('[Impersonate-1st] STScript execution complete, about to restore profile...');
            
            // After completion, read the new input and store it using the setter
            setLastImpersonateResult(textarea.value);
            debugLog('[Impersonate-1st] STScript executed, new input stored in shared state.');

        } else {
            console.error('[GuidedGenerations] context.executeSlashCommandsWithOptions not found!');
        }
    } catch (error) {
        console.error(`[GuidedGenerations] Error executing Guided Impersonate (1st) stscript: ${error}`);
        setLastImpersonateResult(''); // Use setter to clear shared state on error
    } finally {
        try {
            await restore();
            debugLog('[Impersonate-1st] Profile restore complete');
        } finally {
            isGuidedImpersonateRunning = false;
        }
    }
};

// Export the function
export { guidedImpersonate };
