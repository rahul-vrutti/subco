const mqtt = require('mqtt');
const express = require('express');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Express app setup
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json());

// MQTT client setup with enhanced configuration
const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://100.103.254.213:1883';
console.log('brokerUrl: ', brokerUrl);
console.log('Attempting to connect to MQTT broker...');

const client = mqtt.connect(brokerUrl, {
    connectTimeout: 30 * 1000, // 30 seconds
    reconnectPeriod: 5000, // 5 seconds
    clean: true,
    keepalive: 60
});

// Define version (will be initialized with current running image version)
let version = 'detecting...';

// Track current container image version
let currentImageVersion = process.env.SUBCO_IMAGE_VERSION || 'detecting...';
let imageVersions = [];

// Function to get current running Docker image version for subco
async function getCurrentRunningImageVersion() {
    try {
        console.log('🔍 Detecting current running subco image version...');

        // Try to find the running container by service name (subco)
        const { stdout: containersOutput } = await execPromise(
            `docker ps --format "{{.Names}}\t{{.Image}}" | grep -i subco || echo "not_found"`
        );

        if (containersOutput.includes('not_found') || !containersOutput.trim()) {
            console.log('No running subco container found');
            return 'not-running';
        }

        const lines = containersOutput.trim().split('\n');
        for (const line of lines) {
            const [containerName, imageName] = line.split('\t');
            if (containerName && imageName) {
                console.log(`Found running subco container: ${containerName} using image: ${imageName}`);
                return imageName;
            }
        }

        return 'unknown';
    } catch (error) {
        console.error('Error detecting subco image version:', error.message);
        return 'detection-failed';
    }
}

// Function to initialize subco version information
async function initializeSubcoVersions() {
    try {
        console.log('🔍 Initializing subco with current running image version...');

        // Detect current running image version
        const detectedImageVersion = await getCurrentRunningImageVersion();

        // Update current image version
        currentImageVersion = detectedImageVersion;

        // For the service version, extract a clean version if possible
        if (detectedImageVersion && detectedImageVersion !== 'not-running' && detectedImageVersion !== 'detection-failed') {
            // Try to extract version from image tag (e.g., subco:v2.1.0 -> v2.1.0)
            const match = detectedImageVersion.match(/:(.+)$/);
            if (match && match[1] && match[1] !== 'latest') {
                version = match[1];
            } else {
                version = detectedImageVersion;
            }
        } else {
            version = detectedImageVersion;
        }

        console.log('✅ Subco version initialization completed:');
        console.log(`   Service version: ${version}`);
        console.log(`   Container image version: ${currentImageVersion}`);

    } catch (error) {
        console.error('❌ Error initializing subco versions:', error);
        // Fallback to detection failed if initialization fails
        version = 'detection-failed';
        currentImageVersion = 'detection-failed';
    }
}

// Helper functions to get device information
function getLocalIPAddress() {
    const envIP = process.env.SUBCO_IP || 'undefined';
    console.log('envIP: ', envIP);
    return envIP;
}

function getMACAddress() {
    const envMAC = process.env.SUBCO_MAC || 'undefined';
    console.log('envMAC: ', envMAC);
    return envMAC;
}

function getDeviceStatus() {
    return {
        ip: getLocalIPAddress(),
        mac: getMACAddress(),
        version: version,
        containerImageVersion: currentImageVersion,
        availableImageVersions: imageVersions,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    };
}

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

app.get('/device-status', (req, res) => {
    res.json(getDeviceStatus());
});

app.get('/image-versions', (req, res) => {
    res.json({
        currentImageVersion: currentImageVersion,
        availableImageVersions: imageVersions,
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

    // Start publishing device status every 30 seconds
    console.log('🚀 Starting device status publishing every 30 seconds...');

    // Publish immediately upon connection
    publishDeviceStatus();

    // Set up interval for publishing device status
    setInterval(() => {
        if (client.connected) {
            publishDeviceStatus();
        } else {
            console.log('⚠️ MQTT client not connected, skipping device status publish');
        }
    }, 30 * 1000); // 30 seconds
});

// Function to publish device status
function publishDeviceStatus() {
    try {
        const deviceStatus = getDeviceStatus();
        const message = JSON.stringify(deviceStatus);

        client.publish('/DeviceStatus', message, (err) => {
            if (err) {
                console.error('❌ Failed to publish device status:', err);
            } else {
                console.log(`📤 Published device status: IP=${deviceStatus.ip}, MAC=${deviceStatus.mac}, Version=${deviceStatus.version}`);
            }
        });
    } catch (error) {
        console.error('❌ Error creating device status message:', error);
    }
}

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

                // Update available image versions if provided
                if (fileInfo.imageVersions && Array.isArray(fileInfo.imageVersions)) {
                    imageVersions = fileInfo.imageVersions;
                    console.log('✅ Updated available image versions:', imageVersions);

                    // Find and set current subco image version
                    const subcoImage = imageVersions.find(img => img.includes('subco'));
                    if (subcoImage) {
                        currentImageVersion = subcoImage;
                        console.log(`✅ Updated current container image version to: ${currentImageVersion}`);
                    }
                }

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
app.listen(PORT, async () => {
    console.log(`🚀 Express server started on port ${PORT}`);

    // Initialize subco with current running image version
    await initializeSubcoVersions();
});


// near top where you define `app`, `server`, `client` (mqtt client)
function shutdown(signal) {
    console.log(`[shutdown] received ${signal}, closing gracefully...`);
    try {
        if (client) {
            // end(true) closes immediately; end(false) waits to drain
            client.end(false, () => console.log('[shutdown] MQTT closed'));
        }
    } catch { }
    try {
        if (server) {
            server.close(() => {
                console.log('[shutdown] HTTP server closed');
                process.exit(0);
            });
            // safety timeout in case close hangs
            setTimeout(() => process.exit(0), 8000).unref();
        } else {
            setTimeout(() => process.exit(0), 2000).unref();
        }
    } catch {
        process.exit(0);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
