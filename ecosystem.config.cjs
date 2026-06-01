/** PM2 config — chạy bản build TypeScript (dist/), KHÔNG dùng src/server.js cũ */
module.exports = {
  apps: [
    {
      name: 'bot',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
