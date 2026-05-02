module.exports = {
  apps: [
    {
      name: 'gsc-hub',
      script: 'build/index.js',
      cwd: '/Users/vid/code/gsc-hub',
      env: {
        NODE_ENV: 'production',
        PORT: '5173',
        HOST: '127.0.0.1'
      }
    }
  ]
};
