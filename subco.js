const mqtt = require('mqtt');
const express = require('express');

// Express app setup
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// MQTT client setup with enhanced configuration
const brokerUrl = process.env.MQTT_BROKER_URL;
console.log('brokerUrl: ', brokerUrl);
console.log('Attempting to connect to MQTT broker...');

const client = mqtt.connect(brokerUrl, {
    connectTimeout: 30 * 1000, // 30 seconds
    reconnectPeriod: 5000, // 5 seconds
    clean: true,
    keepalive: 60
});

// Define version (will be incremented when updates are received)
let version = '1.0.0';

// Express API endpoints
app.get('/', (req, res) => {
    res.json({
        service: 'subco',
        status: 'running',
        mqtt: {
            connected: client.connected,
            brokerUrl: brokerUrl
        },
        timestamp: new Date().toISOString()
    });
});

app.get('/version', (req, res) => {
    res.json({
        version: version,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        mqtt: {
            connected: client.connected,
            brokerUrl: brokerUrl
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

client.on('connect', () => {
    console.log('✅ Subco successfully connected to MQTT broker');
    console.log('Connection details:', {
        brokerUrl: brokerUrl,
        clientId: client.options.clientId,
        timestamp: new Date().toISOString()
    });

    // Subscribe to both topics
    client.subscribe('/getVersion', (err) => {
        if (err) {
            console.error('❌ Subscription error for /getVersion:', err);
        } else {
            console.log('✅ Successfully subscribed to /getVersion');
        }
    });

    client.subscribe('/newUpdate', (err) => {
        if (err) {
            console.error('❌ Subscription error for /newUpdate:', err);
        } else {
            console.log('✅ Successfully subscribed to /newUpdate');
        }
    });
});

client.on('reconnect', () => {
    console.log('🔄 MQTT client attempting to reconnect...');
});

client.on('close', () => {
    console.log('⚠️ MQTT connection closed');
});

client.on('disconnect', () => {
    console.log('⚠️ MQTT client disconnected');
});

client.on('offline', () => {
    console.log('⚠️ MQTT client is offline');
});

client.on('error', (error) => {
    console.error('❌ MQTT connection error:', error);
    console.error('Error details:', {
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        address: error.address,
        port: error.port,
        timestamp: new Date().toISOString()
    });

    // Log specific connection issues
    if (error.code === 'ECONNREFUSED') {
        console.error('🚫 Connection refused - MQTT broker may not be running or accessible');
        console.error(`Check if MQTT broker is running at: ${brokerUrl}`);
    } else if (error.code === 'ENOTFOUND') {
        console.error('🚫 Host not found - Check the MQTT broker URL');
    } else if (error.code === 'ETIMEDOUT') {
        console.error('🚫 Connection timeout - MQTT broker may be unreachable');
    }
});

// Helper function to increment version
function incrementVersion(currentVersion) {
    const parts = currentVersion.split('.');
    const patch = parseInt(parts[2]) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
}

client.on('message', (topic, message) => {
    try {
        if (topic === '/getVersion') {
            // Respond with current version
            client.publish('/Version', version);
            console.log(`📤 Responded with version: ${version}`);
        } else if (topic === '/newUpdate') {
            try {
                // Parse the file information from buco
                const fileInfo = JSON.parse(message.toString());
                console.log('📨 Received file update:', fileInfo);

                // Check if specific subco version is provided
                if (fileInfo.versions && fileInfo.versions.subcoVersion) {
                    // Use the specific version from the file
                    version = fileInfo.versions.subcoVersion;
                    console.log(`✅ Version set to: ${version} from version file`);
                } else {
                    // Fallback to increment version when no specific version provided
                    version = incrementVersion(version);
                    console.log(`📈 Version incremented to: ${version}`);
                }

                // Respond with new version to /Version topic
                client.publish('/Version', version);
                console.log(`📤 Published new version: ${version}`);

            } catch (parseError) {
                console.error('❌ Error parsing file update message:', parseError);
                console.error('Raw message:', message.toString());
            }
        }
    } catch (error) {
        console.error('❌ Error processing MQTT message:', error);
        console.error('Topic:', topic);
        console.error('Message:', message.toString());
    }
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 Express server started on port ${PORT}`);
});
