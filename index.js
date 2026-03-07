import controlPanel from './frontend/index.js';

console.log('🎛️ Starting Control Panel Server...');
controlPanel.init().catch(err => {
    console.error('Failed to start control panel:', err);
    process.exit(1);
});

function shutdown(signal) {
    console.log(`\n🛑 Shutting down control panel (${signal})...`);
    controlPanel.stop(() => {
        process.exit(0);
    });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
