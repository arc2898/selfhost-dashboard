const si = require('systeminformation');
const os = require('os');

let lastNet = null;
let lastNetTime = null;

async function getOverview() {
  const [osInfo, cpu, mem, currentLoad, disks, time, networkStats] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.mem(),
    si.currentLoad(),
    si.fsSize(),
    si.time(),
    si.networkStats(),
  ]);

  let temp = null;
  try {
    const t = await si.cpuTemperature();
    temp = Number.isFinite(t.main) && t.main > 0 ? t.main : null;
  } catch { /* not available on this platform */ }

  const totalDisk = disks.reduce((a, d) => a + d.size, 0);
  const usedDisk = disks.reduce((a, d) => a + d.used, 0);

  const netTotals = networkStats.reduce((acc, n) => {
    acc.rx += n.rx_sec || 0;
    acc.tx += n.tx_sec || 0;
    return acc;
  }, { rx: 0, tx: 0 });

  return {
    hostname: osInfo.hostname,
    platform: osInfo.platform,
    distro: osInfo.distro,
    release: osInfo.release,
    arch: osInfo.arch,
    kernel: osInfo.kernel,
    uptimeSeconds: time.uptime,
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speedGHz: cpu.speed,
      usagePercent: Math.round(currentLoad.currentLoad * 10) / 10,
      perCore: currentLoad.cpus.map(c => Math.round(c.load * 10) / 10),
      loadAvg: os.loadavg(),
      temperatureC: temp,
    },
    memory: {
      totalBytes: mem.total,
      usedBytes: mem.active,
      freeBytes: mem.available,
      cachedBytes: mem.cached,
      swapTotalBytes: mem.swaptotal,
      swapUsedBytes: mem.swapused,
      usagePercent: Math.round((mem.active / mem.total) * 1000) / 10,
    },
    disk: {
      totalBytes: totalDisk,
      usedBytes: usedDisk,
      usagePercent: totalDisk ? Math.round((usedDisk / totalDisk) * 1000) / 10 : 0,
      mounts: disks.map(d => ({
        mount: d.mount,
        fs: d.fs,
        type: d.type,
        totalBytes: d.size,
        usedBytes: d.used,
        freeBytes: d.size - d.used,
        usagePercent: Math.round(d.use * 10) / 10,
      })),
    },
    network: {
      downloadBytesPerSec: Math.round(netTotals.rx),
      uploadBytesPerSec: Math.round(netTotals.tx),
    },
    now: new Date().toISOString(),
  };
}

async function getNetworkInterfaces() {
  const [ifaces, stats] = await Promise.all([si.networkInterfaces(), si.networkStats()]);
  const statByIface = Object.fromEntries(stats.map(s => [s.iface, s]));
  return ifaces
    .filter(i => !i.internal)
    .map(i => {
      const s = statByIface[i.iface] || {};
      return {
        iface: i.iface,
        ip4: i.ip4,
        ip6: i.ip6,
        mac: i.mac,
        type: i.type,
        speedMbps: i.speed,
        downloadBytesPerSec: Math.round(s.rx_sec || 0),
        uploadBytesPerSec: Math.round(s.tx_sec || 0),
        totalDownloadedBytes: s.rx_bytes || 0,
        totalUploadedBytes: s.tx_bytes || 0,
      };
    });
}

async function getProcesses() {
  const data = await si.processes();
  return {
    total: data.all,
    running: data.running,
    blocked: data.blocked,
    list: data.list.map(p => ({
      pid: p.pid,
      name: p.name,
      user: p.user,
      cpu: Math.round((p.cpu || 0) * 10) / 10,
      memPercent: Math.round((p.mem || 0) * 10) / 10,
      memBytes: p.memRss ? p.memRss * 1024 : 0,
      state: p.state,
      started: p.started,
      command: p.command,
    })),
  };
}

async function killProcess(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') throw Object.assign(new Error('No such process'), { status: 404 });
    if (e.code === 'EPERM') throw Object.assign(new Error('Not permitted to terminate this process'), { status: 403 });
    throw e;
  }
}

module.exports = { getOverview, getNetworkInterfaces, getProcesses, killProcess };
