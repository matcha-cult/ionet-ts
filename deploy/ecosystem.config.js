// PM2 集群部署配置
// 启动: pm2 start deploy/ecosystem.config.js
// 管理: pm2 list / pm2 logs / pm2 restart all / pm2 stop all

module.exports = {
  apps: [
    {
      name: 'ionet-cluster',
      script: './demos/demo-cluster/dist/main.js',
      instances: 3,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        HTTP_PORT: 8080,
        WS_PORT: 9080,
      },
      env_development: {
        NODE_ENV: 'development',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        HTTP_PORT: 8080,
        WS_PORT: 9080,
      },
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      listen_timeout: 5000,
      kill_timeout: 10000,
      wait_ready: true,
    },
  ],
};
