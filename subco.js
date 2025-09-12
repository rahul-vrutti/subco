// MQTT client setup for /getVersion and /newUpdate topics
const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// Define broker URL (change as needed)
const brokerUrl = 'mqtt://localhost:1883';
const client = mqtt.connect(brokerUrl);

// Define version (will be incremented when updates are received)
let version = '1.0.0';

client.on('connect', () => {
    console.log('Connected to MQTT broker');

    // Subscribe to both topics
    client.subscribe('/getVersion', (err) => {
        if (err) {
            console.error('Subscription error for /getVersion:', err);
        } else {
            console.log('Subscribed to /getVersion');
        }
    });

    client.subscribe('/newUpdate', (err) => {
        if (err) {
            console.error('Subscription error for /newUpdate:', err);
        } else {
            console.log('Subscribed to /newUpdate');
        }
    });
});

// Helper function to increment version
function incrementVersion(currentVersion) {
    const parts = currentVersion.split('.');
    const patch = parseInt(parts[2]) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
}

client.on('message', (topic, message) => {
    if (topic === '/getVersion') {
        // Respond with current version
        client.publish('/Version', version);
        console.log(`Responded with version: ${version}`);
    } else if (topic === '/newUpdate') {
        try {
            // Parse the file information from buco
            const fileInfo = JSON.parse(message.toString());
            console.log('Received file update:', fileInfo);

            // Check if specific subco version is provided
            if (fileInfo.versions && fileInfo.versions.subcoVersion) {
                // Use the specific version from the file
                version = fileInfo.versions.subcoVersion;
                console.log(`Version set to: ${version} from version file`);
            } else {
                // Fallback to increment version when no specific version provided
                version = incrementVersion(version);
                console.log(`Version incremented to: ${version}`);
            }

            // Respond with new version to /Version topic
            client.publish('/Version', version);
            console.log(`Published new version: ${version}`);

        } catch (error) {
            console.error('Error processing file update:', error);
        }
    }
});
