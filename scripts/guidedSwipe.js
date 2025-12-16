// scripts/guidedSwipe.js

import { getContext, extension_settings, debugLog, setPreviousImpersonateInput, getPreviousImpersonateInput, setImpersonateRestoreFallback } from './persistentGuides/guideExports.js'; // Import from central hub

const extensionName = "GuidedGenerations-Extension";
const PLACEHOLDER = '{{input}}';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function notifySwipeError(message) {
    if (window?.toastr?.error) {
        window.toastr.error(message, 'Guided Swipe');
    } else {
        console.error(`[GuidedGenerations][Swipe] ${message}`);
    }
}

async function runSlashCommand(context, command, options = { displayCommand: false, showOutput: false }) {
    if (!context || typeof context.executeSlashCommandsWithOptions !== 'function') {
        throw new Error('SillyTavern context missing executeSlashCommandsWithOptions');
    }
    await context.executeSlashCommandsWithOptions(command, options);
}

function cloneInstruct(instruct) {
    try {
        return JSON.parse(JSON.stringify(instruct));
    } catch (error) {
        debugLog('[Swipe] Failed to clone instruct injection', error);
        return null;
    }
}

async function backupExistingInstruct(context) {
    const existing = context?.chatMetadata?.script_injects?.instruct;
    if (!existing) return null;
    const cloned = cloneInstruct(existing);
    await runSlashCommand(context, '/flushinject instruct');
    return cloned;
}

async function restoreInstruct(context, saved, fallbackRole) {
    if (!saved) return;
    const role = saved.role || fallbackRole || 'system';
    const scan = typeof saved.scan === 'boolean' ? saved.scan : true;
    const depth = typeof saved.depth === 'number' ? saved.depth : 0;
    const value = saved.value || '';
    const command = `/inject id=instruct position=chat ephemeral=true scan=${scan} depth=${depth} role=${role} ${value}`;
    await runSlashCommand(context, command);
}

async function ensureInjectionExists(context, attempts = 5, waitMs = 150) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const instruct = context?.chatMetadata?.script_injects?.instruct;
        if (instruct) {
            return true;
        }
        if (attempt < attempts) {
            await delay(waitMs);
        }
    }
    return false;
}

/**
 * Waits for generation to complete via SillyTavern events.
 * No timeout is used - relies on event-based completion for reliability.
 * The generation will complete when GENERATION_ENDED fires, or fail if
 * GENERATION_STOPPED or GENERATION_ERROR fire. User can manually stop at any time.
 */
function waitForGeneration(eventSource, event_types) {
    return new Promise((resolve, reject) => {
        const handleSuccess = () => {
            resolve(true);
        };

        const handleStop = () => {
            reject(new Error('Swipe generation stopped.'));
        };

        eventSource.once(event_types.GENERATION_ENDED, handleSuccess);
        if (event_types?.GENERATION_STOPPED) {
            eventSource.once(event_types.GENERATION_STOPPED, handleStop);
        }
        if (event_types?.GENERATION_ERROR) {
            eventSource.once(event_types.GENERATION_ERROR, handleStop);
        }
    });
}

/**
 * Finds the last swipe for the last message, navigates directly to it,
 * and triggers one more swipe (generation) by calling context.swipe.right().
 * Uses direct manipulation for navigation and waits for generation end event.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function generateNewSwipe(context) {
    // Ensure necessary functions/objects are available from SillyTavern's scope
    const expectedContextProps = ['chat', 'messageFormatting', 'eventSource', 'event_types'];
    const missingProps = expectedContextProps.filter(prop => !(prop in context) || context[prop] === undefined);

    if (missingProps.length > 0) {
        const errorMessage = `Could not get necessary functions/objects from context. Missing: ${missingProps.join(', ')}`;
        notifySwipeError(errorMessage);
        return false;
    }

    // Destructure necessary functions and variables from the context *after* validation
    const { chat, messageFormatting, eventSource, event_types } = context;

    try {
        // --- 1. Navigate to Last Existing Swipe (Directly) ---
        if (!context || !Array.isArray(context.chat) || context.chat.length === 0) {
            notifySwipeError('Cannot access chat context.');
            return false;
        }
        let lastMessageIndex = context.chat.length - 1;
        let messageData = context.chat[lastMessageIndex];
        const mesDom = document.querySelector(`#chat .mes[mesid="${lastMessageIndex}"]`);

        // Check if there are swipes and if navigation is needed
        if (messageData && Array.isArray(messageData.swipes) && messageData.swipes.length > 1) {
            const targetSwipeIndex = messageData.swipes.length - 1;
            if (messageData.swipe_id !== targetSwipeIndex) {
                debugLog(`[Swipe] Navigating directly from swipe ${messageData.swipe_id} to last swipe ${targetSwipeIndex}.`);
                messageData.swipe_id = targetSwipeIndex;
                messageData.mes = messageData.swipes[targetSwipeIndex];
                // Optional: Update extra fields if needed, similar to swipes-go
                // messageData.extra = structuredClone(messageData.swipe_info?.[targetSwipeIndex]?.extra);
                // ... other fields

                if (mesDom) {
                    // Update message text in DOM
                    const mesTextElement = mesDom.querySelector('.mes_text');
                    if (mesTextElement) {
                        mesTextElement.innerHTML = messageFormatting(
                            messageData.mes, messageData.name, messageData.is_system, messageData.is_user, lastMessageIndex
                        );
                    }
                    // Update swipe counter in DOM
                    [...mesDom.querySelectorAll('.swipes-counter')].forEach(it => it.textContent = `${messageData.swipe_id + 1}/${messageData.swipes.length}`);
                } else {
                    debugLog(`[Swipe] Could not find DOM element for message ${lastMessageIndex} to update UI during direct navigation.`);
                }

                // Save chat and notify - Removed saveChatConditional() as it's not available
                eventSource.emit(event_types.MESSAGE_SWIPED, lastMessageIndex);
                // Update button visibility - Removed showSwipeButtons() as it's not available
                // showSwipeButtons();
                await delay(150);
            } else {
                debugLog("[Swipe] Already on the last existing swipe.");
            }
        } else {
            debugLog("[Swipe] No existing swipes or only one swipe found. Proceeding to generate first/next swipe.");
        }

        // --- 2. Trigger the *New* Swipe Generation (Using context.swipe.right()) ---
        if (!context || !context.swipe || typeof context.swipe.right !== 'function') {
            const warningMessage = "Core swipe functionality is missing. Please update SillyTavern to v1.13.0+ for Guided Swipe to work.";
            notifySwipeError(warningMessage);
            return false;
        }

        debugLog("[Swipe] Calling context.swipe.right() to trigger new swipe generation...");
        const generationPromise = waitForGeneration(eventSource, event_types);
        context.swipe.right();
        await generationPromise;
        await delay(200);

        // Re-check context to confirm swipe count increased (optional but good practice)
        const latestContext = getContext();
        const latestChat = Array.isArray(latestContext?.chat) ? latestContext.chat : null;
        const finalMessageData = latestChat ? latestChat[latestChat.length - 1] : null;
        const finalSwipeCount = finalMessageData?.swipes?.length ?? 0;
        debugLog(`[Swipe] Final swipe count after generation: ${finalSwipeCount}`);

        return true; // Indicate success

    } catch (error) {
        notifySwipeError(error.message || 'Swipe generation failed.');
        return false; // Indicate failure
    }
}

/**
 * Performs a guided swipe: injects current input as context, swipes to the end,
 * generates a new response, and restores the original input.
 * Uses the extracted generateNewSwipe function and local executeSTScriptCommand.
 */
const guidedSwipe = async () => {
    const textarea = document.getElementById('send_textarea');
    if (!textarea) {
        console.error('[GuidedGenerations][Swipe] Textarea #send_textarea not found.');
        notifySwipeError('Textarea not found.');
        return; // Cannot proceed without textarea
    }
    const originalInput = textarea.value; // Get current input
    const sharedInputSnapshot = getPreviousImpersonateInput();
    setImpersonateRestoreFallback(sharedInputSnapshot);

    const depth = extension_settings[extensionName]?.depthPromptGuidedSwipe ?? 0;
    const context = getContext();
    if (!context) {
        notifySwipeError('SillyTavern context unavailable.');
        return;
    }

    // If no input, skip injection and do a plain swipe
    if (!originalInput.trim()) {
        debugLog("[Swipe] No input detected, performing plain swipe.");
        const swipeSuccess = await generateNewSwipe(context);
        if (swipeSuccess) {
            debugLog("[Swipe] Swipe finished successfully.");
        } else {
            console.error("[GuidedGenerations][Swipe] Swipe failed.");
        }
        return;
    }

    // Get the LATEST injection role setting HERE
    const injectionRole = extension_settings[extensionName]?.injectionEndRole ?? 'system'; // Get the role setting
    let savedInstruct = null;
    let injectedForSwipe = false;

    try {
        // Save the input state using the shared function (imported)
        setPreviousImpersonateInput(originalInput);

        // Use user-defined guided swipe prompt override
        const promptTemplate = extension_settings[extensionName]?.promptGuidedSwipe ?? '';
        const filledPrompt = fillPrompt(promptTemplate, originalInput);
        const sanitizedPrompt = sanitizeForSTScript(filledPrompt);

        // --- 1. Store Input & Inject Context (if any) --- (Use direct context method)
        if (originalInput.trim() || (promptTemplate.trim() !== '' && promptTemplate.trim() !== PLACEHOLDER)) {
            savedInstruct = await backupExistingInstruct(context);
            const stscriptCommand = `/inject id=instruct position=chat ephemeral=true scan=true depth=${depth} role=${injectionRole} ${sanitizedPrompt} |`;
            await runSlashCommand(context, stscriptCommand);
            injectedForSwipe = true;
            debugLog('[Swipe] Executed Command:', stscriptCommand);
        } else {
            debugLog("[Swipe] No input detected, skipping injection.");
        }
        
        if (injectedForSwipe) {
            const injectionExists = await ensureInjectionExists(context);
            if (!injectionExists) {
                throw new Error("Could not verify 'instruct' injection. Aborting swipe generation.");
            }
        }

                // --- 2. Generate the new swipe --- (This now only runs if injection was found)
        debugLog('[Swipe] Instruction injection confirmed. Proceeding to generate new swipe...');
        const swipeSuccess = await generateNewSwipe(context);

        if (swipeSuccess) {
            debugLog("[Swipe] Guided Swipe finished successfully.");
            await delay(300);
        } else {
            console.error("[GuidedGenerations][Swipe] Guided Swipe failed during swipe generation step.");
            // Error likely already alerted within generateNewSwipe
        }

    } catch (error) {
        // Catch errors specific to the guidedSwipe wrapper (e.g., from executeSTScriptCommand)
        console.error("[GuidedGenerations][Swipe] Error during guided swipe wrapper execution:", error);
        notifySwipeError(error.message || 'Guided Swipe failed.');
    } finally {
        // Always attempt to restore the input field from the shared state (imported)
        if (textarea) { // Check if textarea was found initially
            const restoredInput = getPreviousImpersonateInput();
            debugLog(`[Swipe] Restoring input field to: "${restoredInput}" (finally block)`);
            textarea.value = restoredInput;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            // This case should ideally not happen if the initial check passed
            debugLog("[Swipe] Textarea was not available for restoration in finally block.");
        }
        if (context) {
            if (injectedForSwipe) {
                try {
                    await runSlashCommand(context, '/flushinject instruct');
                } catch (flushError) {
                    debugLog('[Swipe] No swipe injection to flush or flush failed.', flushError);
                }
            }
            // Restore previously saved instruct injection if any
            try {
                await restoreInstruct(context, savedInstruct, injectionRole);
            } catch (restoreError) {
                console.error('[GuidedGenerations][Swipe] Failed to restore prior instruct injection:', restoreError);
            }
        }

    }
};

// Export both functions
export { guidedSwipe, generateNewSwipe };
