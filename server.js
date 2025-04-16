// --- server.js ---
require('dotenv').config(); // Load API key from .env file
const WebSocket = require('ws');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

const PORT = process.env.PORT || 8080; // Use environment variable or default
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use a model known for instruction following and JSON output if possible
const MODEL_NAME = "gemini-1.5-flash-latest"; // Keep flash for speed, but test if Pro is better for JSON

if (!GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY not found in environment variables or .env file.");
    process.exit(1); // Stop the server if key is missing
}

// --- Initialize Gemini ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
     model: MODEL_NAME,
     // Specify JSON output mode if available and reliable for the model
     // responseMimeType: "application/json" // Uncomment if using a model version supporting this reliably
});

// --- Gemini Configuration ---
const generationConfig = {
    temperature: 0.5, // Lower temperature for more predictable JSON output
    topK: 1,
    topP: 1,
    maxOutputTokens: 1024,
    // responseMimeType: "application/json" // Also specify here if needed
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// --- Menu Definition ---
// Case-insensitive matching might be needed later
const menu = {
    "chicken fajita platter": { price: 14.99, name: "Chicken Fajita Platter" },
    "steak fajita platter": { price: 16.99, name: "Steak Fajita Platter" },
    "southwest egg rolls": { price: 8.99, name: "Southwest Egg Rolls" }, // Example
    "queso fundido": { price: 7.99, name: "Queso Fundido" }, // Example
    "enchiladas verdes": { price: 13.99, name: "Enchiladas Verdes" }, // Example
    "classic cheeseburger": { price: 11.99, name: "Classic Cheeseburger" }, // Example
    "grilled salmon with mango salsa": { price: 18.99, name: "Grilled Salmon with Mango Salsa" }, // Example
    "chicken fried steak": { price: 15.99, name: "Chicken Fried Steak" }, // Example - corrected price
    "churros with chocolate sauce": { price: 6.99, name: "Churros with Chocolate Sauce" },
    "flan": { price: 5.99, name: "Flan" }, // Example
    "key lime pie": { price: 6.99, name: "Key Lime Pie" }
};
// Function to find menu item ignoring case and plurals (simple version)
function findMenuItem(itemName) {
    if (!itemName) return null;
    const lowerItemName = itemName.toLowerCase().trim();
    for (const key in menu) {
        if (lowerItemName === key || lowerItemName === key + 's' || lowerItemName + 's' === key) {
             return menu[key];
        }
         // Add more flexible matching if needed (e.g., removing 'a', 'an', 'the')
    }
     // Try partial match (e.g., "fajita platter" -> prompt clarification) - more complex
     // For now, require exact or plural match
    return null;
}


// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ port: PORT });
console.log(`WebSocket server started on port ${PORT}`);

// Store client state (history, prompt, and order)
const clientStates = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');
    clientStates.set(ws, {
        history: [], // API history
        systemPrompt: "You are a helpful order-taking assistant for Mario's Kitchen.", // Default prompt
        order: [] // Current order: [{ name: 'Item Name', price: 10.99, quantity: 1 }, ...]
    });
    // Wait for 'setPrompt' message before greeting
});

// --- Helper Functions ---
function sendWsMessage(ws, messageObject) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(messageObject));
    } else {
        console.log("Attempted to send message to closed WebSocket.");
    }
}

// --- WebSocket Message Handling ---
wss.on('connection', (ws) => {
    // ... (connection setup as above) ...

    ws.on('message', async (message) => {
        let parsedMessage;
        const clientState = clientStates.get(ws);
        if (!clientState) {
            console.error("Error: Client state not found.");
            try { ws.close(); } catch (e) {}
            return;
        }

        try {
            const messageString = message instanceof Buffer ? message.toString() : message;
            parsedMessage = JSON.parse(messageString);
            console.log('Received from client:', parsedMessage);
        } catch (e) {
            console.error('Failed to parse message:', message);
            sendWsMessage(ws, { action: 'statusUpdate', text: 'Error: Invalid message format.' });
            return;
        }

        // --- Handle Different Message Types ---
        switch (parsedMessage.type) {
            case 'setPrompt':
                clientState.systemPrompt = parsedMessage.text?.trim() || clientState.systemPrompt; // Use default if empty
                console.log(`System prompt set: "${clientState.systemPrompt}"`);
                const greeting = "Hello! Welcome to Mario's Kitchen. How can I help you take your order?";
                sendWsMessage(ws, { action: 'speak', text: greeting });
                // 'speechEnded' will trigger 'listen'
                break;

            case 'userSpeech':
                const userText = parsedMessage.text;
                if (!userText || userText.trim() === "") {
                    console.log("Received empty user speech.");
                    sendWsMessage(ws, { action: 'speak', text: "Sorry, I didn't catch that. Could you please repeat?" });
                    break; // Don't proceed further
                }

                // Add user message to API history *before* calling Gemini
                const historyForApi = [...clientState.history];
                clientState.history.push({ role: "user", parts: [{ text: userText }] });

                try {
                    // Construct prompt for Gemini to understand intent and items
                    const orderString = clientState.order.map(item => `${item.quantity}x ${item.name}`).join(', ') || 'empty';
                    const intentPrompt = `${clientState.systemPrompt}\n\nCurrent order: [${orderString}]\nUser said: "${userText}"\n\nAnalyze the user's request based ONLY on the current order and the user's statement. Determine the primary intent ('add_item', 'remove_item', 'confirm_order', 'clear_order', 'query_menu', 'other') and list the specific menu items mentioned accurately. If adding/removing, list only the items to be added/removed. If the user asks a general question or makes a statement not related to ordering, use intent 'other'. Provide the response ONLY as a valid JSON object with keys 'intent' (string) and 'items' (array of strings). Example: {"intent": "add_item", "items": ["Chicken Fajita Platter", "Key Lime Pie"]}`;

                    console.log("Sending intent prompt to Gemini...");
                    const intentResult = await model.generateContent({
                        contents: [{ role: "user", parts: [{ text: intentPrompt }] }],
                        generationConfig,
                        safetySettings,
                        // systemInstruction: { role: "system", parts: [{ text: clientState.systemPrompt }]} // System prompt included in user message for this specific task
                    });

                    let intentResponseText = intentResult.response.text();
                    console.log("Raw Gemini intent response:", intentResponseText);

                     // Clean potential markdown ```json ... ```
                     intentResponseText = intentResponseText.replace(/^```json\s*|```$/g, '').trim();

                    let orderAction = { intent: 'other', items: [] }; // Default action
                    try {
                        orderAction = JSON.parse(intentResponseText);
                        if (!orderAction.intent || !Array.isArray(orderAction.items)) {
                             throw new Error("Invalid JSON structure from Gemini");
                        }
                    } catch (jsonError) {
                        console.error("Failed to parse JSON from Gemini:", jsonError, "Raw text:", intentResponseText);
                        // Fallback to general conversation if JSON fails
                        orderAction = { intent: 'other', items: [] };
                    }

                    console.log("Parsed order action:", orderAction);

                    let botResponseText = "";
                    let orderUpdated = false;

                    // --- Process Identified Intent ---
                    switch (orderAction.intent) {
                        case 'add_item':
                            let itemsAdded = [];
                            let itemsNotFound = [];
                            orderAction.items.forEach(itemName => {
                                const menuItem = findMenuItem(itemName);
                                if (menuItem) {
                                    const existingItem = clientState.order.find(i => i.name === menuItem.name);
                                    if (existingItem) {
                                        existingItem.quantity++;
                                    } else {
                                        clientState.order.push({ ...menuItem, quantity: 1 });
                                    }
                                    itemsAdded.push(menuItem.name);
                                    orderUpdated = true;
                                } else {
                                    itemsNotFound.push(itemName);
                                }
                            });
                            if (itemsAdded.length > 0) botResponseText += `Okay, added ${itemsAdded.join(', ')}. `;
                            if (itemsNotFound.length > 0) botResponseText += `Sorry, I couldn't find "${itemsNotFound.join(', ')}" on the menu. `;
                            if (!botResponseText) botResponseText = "Could you clarify what you'd like to add?";
                            else botResponseText += "Anything else?";
                            break;

                        case 'remove_item':
                             let itemsRemoved = [];
                             let itemsNotRemoved = [];
                             orderAction.items.forEach(itemName => {
                                 const menuItem = findMenuItem(itemName); // Find the canonical name/price first
                                 if (menuItem) {
                                     const itemIndex = clientState.order.findIndex(i => i.name === menuItem.name);
                                     if (itemIndex > -1) {
                                         clientState.order[itemIndex].quantity--;
                                         itemsRemoved.push(menuItem.name);
                                         if (clientState.order[itemIndex].quantity <= 0) {
                                             clientState.order.splice(itemIndex, 1); // Remove if quantity is zero
                                         }
                                         orderUpdated = true;
                                     } else {
                                         itemsNotRemoved.push(itemName); // Item wasn't in the order
                                     }
                                 } else {
                                     itemsNotRemoved.push(itemName); // Item not on menu
                                 }
                             });
                             if (itemsRemoved.length > 0) botResponseText += `Okay, removed ${itemsRemoved.join(', ')}. `;
                             if (itemsNotRemoved.length > 0) botResponseText += `Couldn't remove "${itemsNotRemoved.join(', ')}" as it wasn't found or wasn't in your order. `;
                             if (!botResponseText) botResponseText = "Could you clarify what you'd like to remove?";
                             else botResponseText += "Anything else you'd like to change or add?";
                             break;

                        case 'confirm_order':
                            if (clientState.order.length > 0) {
                                botResponseText = "Okay, your order is confirmed. Please proceed to the window.";
                                sendWsMessage(ws, { action: 'finalizeOrder', order: clientState.order });
                                orderUpdated = false; // Don't send updateOrder, finalizeOrder handles it
                            } else {
                                 botResponseText = "Your order is currently empty. What would you like to add?";
                            }
                            break;

                        case 'clear_order':
                             if (clientState.order.length > 0) {
                                 clientState.order = [];
                                 botResponseText = "Okay, I've cleared your order. What can I get started for you?";
                                 orderUpdated = true;
                             } else {
                                 botResponseText = "Your order is already empty.";
                             }
                             break;

                        case 'query_menu':
                        case 'other':
                        default:
                            // Fallback to a general conversational response if intent unclear or not order-related
                            console.log("Falling back to general conversation...");
                            const chat = model.startChat({
                                history: historyForApi, // History before this user turn
                                generationConfig,
                                safetySettings,
                                systemInstruction: { role: "system", parts: [{ text: clientState.systemPrompt }] }
                            });
                            const result = await chat.sendMessage(userText);
                            botResponseText = result.response.text();
                            break;
                    }

                    // Send order update if changed
                    if (orderUpdated) {
                        sendWsMessage(ws, { action: 'updateOrder', order: clientState.order });
                    }

                    // Send bot's spoken response
                    sendWsMessage(ws, { action: 'speak', text: botResponseText });
                    // Add bot response to API history
                    clientState.history.push({ role: "model", parts: [{ text: botResponseText }] });

                } catch (error) {
                    console.error("Error processing user speech or calling Gemini:", error);
                     // Remove the user message that caused the error from history
                     if (clientState.history.length > 0 && clientState.history[clientState.history.length - 1].role === 'user') {
                         console.log("Removing failed user message from history.");
                         clientState.history.pop();
                     }
                    sendWsMessage(ws, { action: 'speak', text: "Sorry, I encountered an technical issue. Please try again." });
                }
                break; // End of userSpeech case

            case 'speechEnded':
                console.log('Client finished speaking.');
                // Always listen after bot finishes speaking
                sendWsMessage(ws, { action: 'listen' });
                break;

            default:
                console.warn("Unhandled message type from client:", parsedMessage.type);
        }
    }); // End ws.on('message')

    ws.on('close', () => {
        console.log('Client disconnected');
        clientStates.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clientStates.delete(ws);
        try { ws.terminate(); } catch (e) {}
    });
}); // End wss.on('connection')

console.log('Agent backend setup complete.');