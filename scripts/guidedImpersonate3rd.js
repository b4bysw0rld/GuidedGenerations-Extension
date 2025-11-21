// scripts/guidedImpersonate3rd.js
import { getContext, extension_settings, extensionName, debugLog, handleSwitching, getPreviousImpersonateInput, setPreviousImpersonateInput, getLastImpersonateResult, setLastImpersonateResult, consumeImpersonateRestoreFallback } from './persistentGuides/guideExports.js'; // Import from central hub

const guidedImpersonate3rd = async () => {
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
        textarea.value = fallback || getPreviousImpersonateInput(); // Use getter
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return; // Restoration done, exit
    }

    // --- If not restoring, proceed with impersonation ---
    setPreviousImpersonateInput(currentInputText); // Use setter

    // Capture the original profile BEFORE any switching happens
    const context = getContext();
    let originalProfile = '';
    if (context && typeof context.executeSlashCommandsWithOptions === 'function') {
        try {
            // Get current profile before any switching
            const { getCurrentProfile } = await import('./persistentGuides/guideExports.js');
            originalProfile = await getCurrentProfile();
            debugLog(`[Impersonate-3rd] Captured original profile before switching: "${originalProfile}"`);
        } catch (error) {
            debugLog(`[Impersonate-3rd] Could not get original profile:`, error);
        }
    }

    // Handle profile and preset switching using unified utility
    const profileKey = 'profileImpersonate3rd';
    const presetKey = 'presetImpersonate3rd';
    const profileValue = extension_settings[extensionName]?.[profileKey] ?? '';
    const presetValue = extension_settings[extensionName]?.[presetKey] ?? '';
    
    // Debug: Log the exact values being retrieved
    debugLog(`[Impersonate-3rd] Profile key: "${profileKey}"`);
    debugLog(`[Impersonate-3rd] Preset key: "${presetKey}"`);
    debugLog(`[Impersonate-3rd] Profile value from settings: "${profileValue}"`);
    debugLog(`[Impersonate-3rd] Preset value from settings: "${presetValue}"`);
    debugLog(`[Impersonate-3rd] All profile settings:`, Object.keys(extension_settings[extensionName] || {}).filter(key => key.startsWith('profile')));
    
    debugLog(`[Impersonate-3rd] Using profile: ${profileValue || 'current'}, preset: ${presetValue || 'none'}`);
    
    const { switch: switchProfileAndPreset, restore } = await handleSwitching(profileValue, presetValue, originalProfile);

    // Use user-defined impersonate prompt override
    const promptTemplate = extension_settings[extensionName]?.promptImpersonate3rd ?? '';
    const filledPrompt = promptTemplate.replace('{{input}}', currentInputText);

    // Build STScript without preset switching
    const stscriptCommand = `/impersonate await=true ${filledPrompt} |`;
    const fullScript = `// Impersonate guide|\n${stscriptCommand}`;

    try {
        const context = getContext();
        if (typeof context.executeSlashCommandsWithOptions === 'function') {
            debugLog('[Impersonate-3rd] About to switch profile and preset...');
            
            // Switch profile and preset before executing
            await switchProfileAndPreset();
            
            debugLog('[Impersonate-3rd] Profile and preset switch complete, about to execute STScript...');
            
            // Execute the command and wait for it to complete
            await context.executeSlashCommandsWithOptions(fullScript); 
            
            debugLog('[Impersonate-3rd] STScript execution complete, about to restore profile...');
            
            // After completion, read the new input and store it using the setter
            setLastImpersonateResult(textarea.value);
            debugLog('[Impersonate-3rd] STScript executed, new input stored in shared state.');

            // After completion, restore original profile and preset using utility restore function
            await restore();
            
            debugLog('[Impersonate-3rd] Profile restore complete');

        } else {
            console.error('[GuidedGenerations] context.executeSlashCommandsWithOptions not found!');
        }
    } catch (error) {
        console.error(`[GuidedGenerations] Error executing Guided Impersonate (3rd) stscript: ${error}`);
        setLastImpersonateResult(''); // Use setter to clear shared state on error
        
        debugLog('[Impersonate-3rd] Error occurred, about to restore profile...');
        
        // Restore original profile and preset on error
        await restore();
        
        debugLog('[Impersonate-3rd] Profile restore complete after error');
    }
};

// Export the function
export { guidedImpersonate3rd };
