"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, execFile } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 3001;

function requestService(pathname, { method = "GET", token = "", timeoutMs = 1200 } = {}) {
  return new Promise((resolve) => {
    const request = http.request({
      hostname: HOST,
      port: PORT,
      path: pathname,
      method,
      timeout: timeoutMs,
      headers: token ? { "x-istore-lifecycle-token": token } : {},
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode || 0));
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(0));
    request.end();
  });
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function forceStopProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (process.platform !== "win32") {
      try { process.kill(pid, "SIGKILL"); } catch (_error) {}
      return resolve();
    }
    execFile("taskkill.exe", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, () => resolve());
  });
}

function createWhatsAppService({ app, baseDataRoot }) {
  let child = null;
  let owned = false;
  let lifecycleToken = "";
  let logHandle = null;

  const serviceSource = app.isPackaged
    ? path.join(process.resourcesPath, "whatsapp-service")
    : path.join(__dirname, "..", "whatsapp_service");
  const serviceDataRoot = path.join(baseDataRoot, "whatsapp-service");

  function closeLog() {
    if (logHandle !== null) {
      try { fs.closeSync(logHandle); } catch (_error) {}
      logHandle = null;
    }
  }

  async function start() {
    if (await requestService("/status") === 200) {
      // A manually started or already-running service is reused but never
      // terminated by this desktop process.
      owned = false;
      return { started: false, reused: true };
    }

    const entrypoint = path.join(serviceSource, "server.js");
    if (!fs.existsSync(entrypoint)) {
      return { started: false, reused: false, error: `WhatsApp service missing: ${entrypoint}` };
    }

    fs.mkdirSync(serviceDataRoot, { recursive: true });
    fs.mkdirSync(path.join(serviceDataRoot, "auth"), { recursive: true });
    const logPath = path.join(serviceDataRoot, "service.log");
    logHandle = fs.openSync(logPath, "a");
    fs.writeSync(logHandle, `\n[${new Date().toISOString()}] Starting WhatsApp service with E Store.\n`);

    lifecycleToken = crypto.randomBytes(32).toString("hex");
    child = spawn(process.execPath, ["--max-old-space-size=256", "--expose-gc", entrypoint], {
      cwd: serviceDataRoot,
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        WHATSAPP_SERVICE_PORT: String(PORT),
        ISTORE_WHATSAPP_AUTH_DATA_PATH: path.join(serviceDataRoot, "auth"),
        ISTORE_WHATSAPP_CONFIG_FILE: path.join(serviceDataRoot, ".portal-bridge.env"),
        ISTORE_WHATSAPP_LIFECYCLE_TOKEN: lifecycleToken,
      },
      stdio: ["ignore", logHandle, logHandle],
    });
    owned = true;
    child.once("error", (error) => {
      try { fs.writeSync(logHandle, `[${new Date().toISOString()}] Start failed: ${error.message}\n`); } catch (_error) {}
    });
    child.once("exit", () => {
      child = null;
      owned = false;
      closeLog();
    });
    return { started: true, reused: false, pid: child.pid };
  }

  async function stop() {
    const ownedChild = child;
    if (!owned || !ownedChild) {
      closeLog();
      return;
    }

    // Ask the service to close Chromium and flush its LocalAuth session first.
    await requestService("/internal/lifecycle/shutdown", {
      method: "POST",
      token: lifecycleToken,
      timeoutMs: 2000,
    });
    const exited = await waitForExit(ownedChild, 6000);
    if (!exited) await forceStopProcessTree(ownedChild.pid);
    child = null;
    owned = false;
    closeLog();
  }

  async function status() {
    const statusCode = await requestService("/status");
    return { online: statusCode === 200, owned, pid: child?.pid || null };
  }

  return { start, stop, status };
}

module.exports = { createWhatsAppService, requestService };
