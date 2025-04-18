// DOM Elements
const mainButton = document.getElementById('main-button');
const disconnectButton = document.getElementById('disconnect-button');
const statusDisplay = document.getElementById('status');
const wsStatusDisplay = document.getElementById('ws-status');
const log = document.getElementById('log');
const systemPromptTextarea = document.getElementById('system-prompt');
// Order UI Elements
const orderList = document.getElementById('order-list');
const orderTotal = document.getElementById('order-total');
const exportButton = document.getElementById('export-button');

// Configuration
const WS_URL = 'ws://localhost:8000/ws/user122'; // Address of your backend WebSocket server

// State Variables
let websocket = null;
let recognition = null;
let isListening = false;
let synth = window.speechSynthesis;
let currentOrder = []; // Store the latest order state for export

// --- Initialize ---
window.onload = () => {
    setupSpeechRecognition();
    logMessage('System', "Enter an optional system prompt, then click 'Connect'.");
    updateOrderDisplay([]); // Initialize order display
};

// --- Speech Recognition Setup ---
function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        logMessage('System', 'Error: Speech Recognition not supported in this browser.');
        mainButton.disabled = true;
        systemPromptTextarea.disabled = true;
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false; // Process speech after user pauses
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        console.log("Recognition started");
        isListening = true;
        statusDisplay.textContent = 'Status: Listening...';
        mainButton.textContent = '🛑 Stop Listening';
        mainButton.classList.add('listening');
        mainButton.disabled = false; // Enable the stop button
    };

    recognition.onresult = (event) => {
        const speechResult = event.results[0][0].transcript;
        console.log("Recognition result:", speechResult);
        logMessage('User', speechResult);
        isListening = false; // Stop listening flag after result

        if (websocket && websocket.readyState === WebSocket.OPEN) {
            // Send speech to backend for intent processing
            websocket.send(JSON.stringify({ type: 'userSpeech', text: speechResult }));
            statusDisplay.textContent = 'Status: Processing order...'; // Changed status
            mainButton.textContent = '🧠 Agent Processing...'; // Changed text
            mainButton.classList.remove('listening');
            mainButton.classList.add('processing');
            mainButton.disabled = true; // Disable button while agent thinks/acts
        } else {
            statusDisplay.textContent = 'Error: WebSocket not connected.';
            resetButtonToConnect(); // Or appropriate state
        }
    };

    recognition.onerror = (event) => {
        console.error("Speech Recognition Error:", event);
        isListening = false;
        statusDisplay.textContent = `Recognition Error: ${event.error}`;
        mainButton.classList.remove('listening');
        // Allow manual restart if connected
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            mainButton.textContent = '🎤 Start Talking';
            mainButton.disabled = false;
        } else {
            resetButtonToConnect();
        }
    };

    recognition.onend = () => {
        console.log("Recognition ended");
        isListening = false;
        // Only change button state if it wasn't immediately set to 'Agent Processing' or 'Agent Speaking'
        if (!mainButton.classList.contains('processing')) {
            mainButton.classList.remove('listening');
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                mainButton.textContent = '🎤 Start Talking'; // Ready for manual start
                mainButton.disabled = false;
            } else {
                resetButtonToConnect();
            }
        }
        // Automatic listening restart is triggered by the backend sending 'listen' command
    };
}

// --- Speech Synthesis ---
function speak(text) {
    // (Same speak function as before - no changes needed here)
    if (!text || text.trim() === '') {
        console.log("Received empty text to speak.");
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: 'speechEnded' }));
        }
        statusDisplay.textContent = 'Status: Agent sent empty response.';
        mainButton.classList.remove('processing');
        mainButton.textContent = '🎤 Start Talking';
        mainButton.disabled = false;
        return;
    }
    if (synth.speaking) {
        console.warn('SpeechSynthesis is already speaking. Cancelling previous utterance.');
        synth.cancel();
    }
    logMessage('Bot', text);
    const utterThis = new SpeechSynthesisUtterance(text);
    utterThis.onstart = () => {
        console.log("SpeechSynthesis started");
        statusDisplay.textContent = 'Status: Agent Speaking...';
        mainButton.textContent = '🔊 Agent Speaking...';
        mainButton.classList.remove('listening');
        mainButton.classList.add('processing');
        mainButton.disabled = true;
    };
    utterThis.onend = () => {
        console.log('SpeechSynthesis finished.');
        statusDisplay.textContent = 'Status: Agent finished speaking.';
        mainButton.classList.remove('processing');
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({ type: 'speechEnded' }));
            mainButton.textContent = '⏳ Waiting...';
            mainButton.disabled = true;
            startListening();
        } else {
            resetButtonToConnect();
        }
    };
    utterThis.onerror = (event) => {
        console.error('SpeechSynthesis Error:', event);
        statusDisplay.textContent = 'Status: Speech error.';
        mainButton.classList.remove('processing');
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            mainButton.textContent = '🎤 Start Talking';
            mainButton.disabled = false;
        } else {
            resetButtonToConnect();
        }
    };
    let voices = synth.getVoices();
    if (voices.length === 0) {
        synth.onvoiceschanged = () => {
            voices = synth.getVoices();
            synth.speak(utterThis);
        };
    } else {
        synth.speak(utterThis);
    }
}

// --- WebSocket Connection ---
function connectWebSocket() {
    // (Largely the same, but resets order display on open)
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        console.log("WebSocket already connected.");
        return;
    }
    wsStatusDisplay.textContent = 'WebSocket: Connecting...';
    statusDisplay.textContent = 'Status: Connecting...';
    mainButton.textContent = '⏳ Connecting...';
    mainButton.disabled = true;
    disconnectButton.disabled = true;
    systemPromptTextarea.disabled = true;
    exportButton.classList.add('hidden'); // Hide export on connect

    websocket = new WebSocket(WS_URL);

    websocket.onopen = (event) => {
        console.log("WebSocket connected");
        wsStatusDisplay.textContent = 'WebSocket: Connected';
        statusDisplay.textContent = 'Status: Connected. Initializing...';
        disconnectButton.disabled = false;
        updateOrderDisplay([]); // Reset order display

        const systemPrompt = systemPromptTextarea.value.trim();
        websocket.send(JSON.stringify({ type: 'setPrompt', text: systemPrompt }));
        console.log("Sent system prompt:", systemPrompt || "(empty)");

        mainButton.textContent = '⏳ Initializing...';
        mainButton.disabled = true;
    };

    websocket.onmessage = (event) => {
        wsStatusDisplay.textContent = `WebSocket: Message Received`;
        console.log("Message from server ", event.data);
        try {
            const message = JSON.parse(event.data);
            handleAgentCommand(message); // Route message to handler
        } catch (e) {
            console.error("Failed to parse message or handle command:", e);
            wsStatusDisplay.textContent = `WebSocket: Error parsing message`;
            logMessage('System', 'Error processing message from server.');
        }
    };

    websocket.onerror = (event) => {
        console.error("WebSocket Error: ", event);
        wsStatusDisplay.textContent = 'WebSocket: Error';
        statusDisplay.textContent = 'Status: Connection error.';
        logMessage('System', 'WebSocket connection error.');
        handleDisconnect(); // Clean up UI
    };

    websocket.onclose = (event) => {
        console.log(`WebSocket closed (Code: ${event.code})`);
        wsStatusDisplay.textContent = `WebSocket: Closed (Code: ${event.code})`;
        statusDisplay.textContent = 'Status: Disconnected.';
        logMessage('System', 'Disconnected from agent.');
        handleDisconnect(); // Clean up UI
    };
}

// --- Handle Commands from Backend Agent ---
function handleAgentCommand(message) {
    // Route actions based on message content
    switch (message.action) {
        case 'speak':
            speak(message.text);
            break;
        case 'listen':
            statusDisplay.textContent = 'Status: Ready for input.';
            startListening(); // Automatically start listening
            break;
        case 'updateOrder':
            updateOrderDisplay(message.order);
            // Keep export button hidden until finalized
            exportButton.classList.add('hidden');
            // Update status - button state is handled by speak/listen flow
            statusDisplay.textContent = 'Status: Order updated.';

            break;
        case 'finalizeOrder':
            updateOrderDisplay(message.order);
            // Show export button
            exportButton.classList.remove('hidden');
            exportButton.disabled = false;
            statusDisplay.textContent = 'Status: Order finalized.';
            // Usually followed by a 'speak' confirmation from backend
            break;
        case 'statusUpdate':
            statusDisplay.textContent = `Status: ${message.text}`;
            break;
        default:
            console.warn("Unknown action received from agent:", message);
    }
}

// --- Start Listening Function ---
function startListening() {
    // (Same startListening function as before - no changes needed here)
    if (!recognition) {
        logMessage('System', 'Cannot listen: Speech Recognition not available.');
        return;
    }
    if (isListening) {
        console.log("Already listening.");
        return;
    }
    if (synth.speaking) {
        console.log("Attempted to listen while speaking, cancelling speech.");
        synth.cancel();
    }
    try {
        if (recognition && !isListening) {
            console.log("Starting speech recognition...");
            recognition.start();
        } else {
            console.log("Already listening or recognition not available.");
        }
    } catch (e) {
        console.error("Error starting recognition:", e);
        statusDisplay.textContent = "Error starting listening.";
        mainButton.textContent = '🎤 Start Talking';
        mainButton.disabled = false;
        mainButton.classList.remove('listening', 'processing');
    }
}

// --- Button Controls ---
mainButton.addEventListener('click', () => {
    console.log("connect button");
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        connectWebSocket();
    } else if (isListening) {
        console.log("Manual stop listening requested.");
        recognition.stop();
    } else if (!synth.speaking && !isListening) {
        console.log("Manual start listening requested.");
        startListening();
    }
});

disconnectButton.addEventListener('click', () => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        console.log("Disconnecting WebSocket...");
        websocket.close();
    } else {
        console.log("Already disconnected.");
    }
});

exportButton.addEventListener('click', () => {
    exportOrder();
});


// --- Order Management UI ---
function updateOrderDisplay(orderItems) {
    orderList.innerHTML = ''; // Clear current list
    let calculatedTotal = 0;
    currentOrder = orderItems; // Store for export

    if (!orderItems || orderItems.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Order is empty.';
        li.classList.add('text-gray-500', 'italic');
        orderList.appendChild(li);
    } else {
        orderItems.forEach(item => {
            if (item && typeof item.name === 'string' && typeof item.price === 'number' && typeof item.quantity === 'number' && item.quantity > 0) {
                const li = document.createElement('li');
                const itemTotal = item.price * item.quantity;
                li.textContent = `${item.name} (x${item.quantity}) - $${itemTotal.toFixed(2)}`;
                orderList.appendChild(li);
                calculatedTotal += itemTotal;
            } else {
                console.warn("Received invalid item in order update:", item);
            }
        });
    }

    orderTotal.textContent = calculatedTotal.toFixed(2); // Update total display
}

// --- Export Functionality ---
function exportOrder() {
    if (!currentOrder || currentOrder.length === 0) {
        logMessage('System', 'Cannot export empty order.');
        return;
    }

    let exportText = "--- Mario's Kitchen Order ---\n\n";
    let calculatedTotal = 0;

    currentOrder.forEach(item => {
        const itemTotal = item.price * item.quantity;
        exportText += `${item.name} (x${item.quantity}) - $${itemTotal.toFixed(2)}\n`;
        calculatedTotal += itemTotal;
    });

    exportText += `\n---------------------------\n`;
    exportText += `Total: $${calculatedTotal.toFixed(2)}\n`;
    exportText += `---------------------------\n`;
    exportText += `Timestamp: ${new Date().toLocaleString()}\n`;


    // Create a blob and trigger download
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marios_kitchen_order_${Date.now()}.txt`; // Filename
    document.body.appendChild(a); // Required for Firefox
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logMessage('System', 'Order exported.');
    exportButton.disabled = true; // Disable after export
}


// --- Utility Functions ---
function logMessage(sender, message) {
    // (Same logMessage function as before)
    const p = document.createElement('p');
    const safeMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    p.innerHTML = `<strong>${sender}:</strong> ${safeMessage}`;
    p.classList.add(sender.toLowerCase());
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
}

function resetButtonToConnect() {
    // (Same resetButtonToConnect function as before)
    mainButton.textContent = '🔌 Connect';
    mainButton.disabled = false;
    mainButton.classList.remove('listening', 'processing');
    disconnectButton.disabled = true;
    systemPromptTextarea.disabled = false;
    exportButton.classList.add('hidden'); // Ensure export hidden
    updateOrderDisplay([]); // Clear order display
}

function handleDisconnect() {
    // (Same handleDisconnect function as before, includes resetting order display)
    websocket = null;
    if (recognition && isListening) {
        recognition.abort();
    }
    isListening = false;
    if (synth.speaking) {
        synth.cancel();
    }
    resetButtonToConnect(); // Resets buttons and order display
}