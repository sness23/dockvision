/* pm2 ecosystem for DockVision on www0.
 * Run with: pm2 start ecosystem.config.cjs --env production
 * Reload: pm2 reload ecosystem.config.cjs
 */
module.exports = {
	apps: [
		{
			name: 'dockvision-web',
			script: 'build/index.js',
			cwd: '/srv/dockvision',
			instances: 1,
			exec_mode: 'fork',
			env: {
				NODE_ENV: 'production',
				PORT: 3000,
				HOST: '127.0.0.1'
			},
			env_file: '/etc/dockvision/env',
			max_memory_restart: '1G',
			error_file: '/var/log/dockvision/web.err.log',
			out_file: '/var/log/dockvision/web.out.log'
		},
		{
			name: 'dockvision-worker',
			script: 'build/workers/job-worker.js',
			cwd: '/srv/dockvision',
			instances: 1,
			exec_mode: 'fork',
			env: { NODE_ENV: 'production' },
			env_file: '/etc/dockvision/env',
			max_memory_restart: '512M',
			error_file: '/var/log/dockvision/worker.err.log',
			out_file: '/var/log/dockvision/worker.out.log',
			autorestart: true
		},
		{
			name: 'dockvision-recon',
			script: 'build/workers/recon.js',
			cwd: '/srv/dockvision',
			cron_restart: '*/15 * * * *',
			autorestart: false,
			env: { NODE_ENV: 'production' },
			env_file: '/etc/dockvision/env',
			error_file: '/var/log/dockvision/recon.err.log',
			out_file: '/var/log/dockvision/recon.out.log'
		},
		{
			name: 'dockvision-msa',
			script: '/srv/dockvision-msa/serve.sh',
			cwd: '/srv/dockvision-msa',
			instances: 1,
			exec_mode: 'fork',
			env_file: '/etc/dockvision/env',
			max_memory_restart: '32G',
			error_file: '/var/log/dockvision/msa.err.log',
			out_file: '/var/log/dockvision/msa.out.log'
		}
	]
};
