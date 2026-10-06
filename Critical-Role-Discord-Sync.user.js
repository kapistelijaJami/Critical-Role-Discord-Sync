// ==UserScript==
// @name         Critical Role Video ↔ Discord Sync
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Sync video events from Beacon to Discord and keep live chat in sync
// @author       You
// @updateURL    https://raw.githubusercontent.com/kapistelijaJami/Critical-Role-Discord-Sync/main/Critical-Role-Discord-Sync.user.js
// @downloadURL  https://raw.githubusercontent.com/kapistelijaJami/Critical-Role-Discord-Sync/main/Critical-Role-Discord-Sync.user.js
// @match        https://discord.com/*
// @match        https://beacon.tv/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=beacon.tv
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        unsafeWindow
// ==/UserScript==

/* global BigInt */
/* eslint-disable no-multi-spaces */

(function () {
    'use strict';

    const STATE_KEY = "cr-video-state";
    const CONFIG_KEY = "cr-config";

    const HEARTBEAT_MS = 5000;           // Beacon -> Discord drift correction while playing
    const SESSION_TIMEOUT_MS = 20000;    // no message from Beacon for this long => session over
    const TICK_MS = 250;                 // Discord scroll loop interval
    const JUMP_COOLDOWN_MS = 4000;       // minimum time between automatic re-jumps
    const GAP_BEFORE_MS = 30000;         // target this far before loaded messages => re-jump
    const GAP_AFTER_MS = 120000;         // target this far after loaded messages => re-jump
    const ALLOW_IN_ANY_CONTENT = true;   // If true, allows sync in any page in /content/ that has a video element.

    /* ------------------------------------------------------------
     * Beacon
     * ------------------------------------------------------------ */

    function isBeacon() {
        return location.hostname === "beacon.tv";
    }

    function send(event) {
        const message = { ...event, source: "beacon", sentAt: Date.now() };
        GM_setValue(STATE_KEY, message);
        console.log("[CR Sync] →", message);
    }

    const MONTHS = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
        august: 7, september: 8, october: 9, november: 10, december: 11,
    };

    function currentTitle() {
        return document.querySelector("h1")?.innerText.trim() ?? "";
    }

    function isEpisodePage(requireVideo = false) {
        if (!location.pathname.startsWith("/content/")) return false;
        const title = currentTitle();
        if (ALLOW_IN_ANY_CONTENT && title && (!requireVideo || document.querySelector("video"))) {
            return true;
        }
        return /^C4\s+E\d+\s*\|\s*\S/i.test(title);
    }

    // Fallback: "Original Air Date: October 2, 2026" -> that day at 02:00 UTC
    function readAirDateFromPage() {
        for (const el of document.querySelectorAll("span")) {
            const m = el.textContent.match(
                /^\s*Original Air Date:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/i
            );
            if (!m) continue;
            const month = MONTHS[m[1].toLowerCase()];
            if (month === undefined) continue;
            return Date.UTC(Number(m[3]), month, Number(m[2]), 2, 0, 0);
        }
        return null;
    }

    // datePublished from the JSON-LD (e.g. 01:45Z), rounded to the nearest hour.
    function readAirDateFromJsonLd(title) {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const data = JSON.parse(s.textContent);
                if (data["@type"] !== "TVEpisode" || data.name?.trim() !== title) continue;
                const ms = Date.parse(data.datePublished);
                if (!Number.isNaN(ms)) return Math.round(ms / 3600000) * 3600000;
            } catch (e) {}
        }
        return null;
    }

    function getStreamStart(title) {
        const ld = readAirDateFromJsonLd(title);
        if (ld) return { ms: ld, source: "jsonld" };

        const page = readAirDateFromPage();
        if (page) return { ms: page, source: "page" };

        return null;
    }

    function getEpisodeInfo() {
        if (!isEpisodePage()) return null;
        const title = currentTitle();
        const start = getStreamStart(title);
        return start ? { title, streamStartMs: start.ms, startSource: start.source } : null;
    }

    function setupBeacon() {
        let syncing = false;
        let video = null;
        let episode = null;
        let heartbeat = null;
        let handlers = {};

        const report = (type) => {
            if (!video || !episode) return;
            send({
                type,
                timestamp: video.currentTime,
                paused: video.paused,
                rate: video.playbackRate,
                title: episode.title,
                streamStartMs: episode.streamStartMs,
                startSource: episode.startSource,
            });
        };

        function start() {
            episode = getEpisodeInfo();
            if (!episode) {
                alert("Couldn't find the episode title or air date on this page.");
                return;
            }
            video = document.querySelector("video");
            if (!video) {
                episode = null;
                alert("No video found on this page.");
                return;
            }

            handlers = {
                play: () => report("play"),
                pause: () => report("pause"),
                seeked: () => report("seek"),
                ratechange: () => report("rate"),
            };
            for (const [ev, fn] of Object.entries(handlers)) video.addEventListener(ev, fn);

            heartbeat = setInterval(() => {
                // Player replaced, or navigated to a different/non-episode page.
                if (!video.isConnected || !isEpisodePage() || currentTitle() !== episode.title) {
                    return stop();
                }
                report("tick");
            }, HEARTBEAT_MS);

            syncing = true;
            report("ready");
            refreshButton();
        }

        function stop() {
            if (video) {
                for (const [ev, fn] of Object.entries(handlers)) video.removeEventListener(ev, fn);
            }
            clearInterval(heartbeat);
            heartbeat = null;
            video = null;
            episode = null;
            handlers = {};
            if (syncing) send({ type: "stop" });
            syncing = false;
            refreshButton();
        }

        const button = document.createElement("button");
        Object.assign(button.style, {
            position: "fixed", bottom: "16px", left: "16px", zIndex: 99999,
            padding: "8px 12px", background: "rgba(0,0,0,.75)", color: "#fff",
            font: "13px sans-serif", border: "1px solid #888", borderRadius: "6px",
            cursor: "pointer", display: "none",
        });
        button.addEventListener("click", () => (syncing ? stop() : start()));
        document.body.appendChild(button);

        function refreshButton() {
            button.style.display = syncing || isEpisodePage(true) ? "" : "none";
            const text = syncing ? "Stop Discord sync" : "Start Discord sync";
            if (button.textContent !== text) button.textContent = text;
        }

        setInterval(refreshButton, 1000);
        refreshButton();

        window.addEventListener("pagehide", () => { if (syncing) stop(); });
    }

    /* ------------------------------------------------------------
     * Discord: helpers
     * ------------------------------------------------------------ */

    function isDiscord() {
        return location.hostname === "discord.com" ||
               location.hostname.endsWith(".discord.com");
    }

    const DISCORD_EPOCH = 1420070400000n;

    function timeToSnowflake(unixMs) {
        const ms = BigInt(Math.max(Math.floor(unixMs), Number(DISCORD_EPOCH)));
        return ((ms - DISCORD_EPOCH) << 22n).toString();
    }

    function snowflakeToTime(id) {
        return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
    }

    function spaNavigate(path) {
        const win = unsafeWindow;
        const method = onTargetChannel() ? "replaceState" : "pushState";
        win.history[method](null, "", path);
        win.dispatchEvent(new win.PopStateEvent("popstate", { state: null }));
    }

    function jumpToTime(guildId, channelId, unixMs) {
        const path = `/channels/${guildId}/${channelId}/${timeToSnowflake(unixMs)}`;
        try {
            spaNavigate(path);
        } catch (e) {
            unsafeWindow.location.href = path; // fallback: full reload
        }
    }

    /* ------------------------------------------------------------
     * Discord: config
     * ------------------------------------------------------------ */

    const DEFAULT_CONFIG = {
        guildId: "1205264867204792340",
        channelId: "1401347893193081005",
        offsets: {},        // episode title -> offset (ms)
        startOverrides: {}, // episode title -> stream start (ms, UTC)
    };

    let config = Object.assign({}, DEFAULT_CONFIG, GM_getValue(CONFIG_KEY, {}));

    function saveConfig() {
        GM_setValue(CONFIG_KEY, config);
    }

    /* ------------------------------------------------------------
     * Discord: sync engine
     * ------------------------------------------------------------ */

    let videoState = null;
    let enabled = true;
    let followPaused = false;   // user scrolled away manually
    let pendingSeek = false;    // strict repositioning after seek/ready
    let needsAlign = true;      // align once even while video is paused
    let lastJumpAt = 0;
    let badge = null;

    function sessionAlive() {
        return !!videoState && Date.now() - videoState.sentAt < SESSION_TIMEOUT_MS;
    }

    function isPlaying() {
        return sessionAlive() && !videoState.paused;
    }

    // Everything the script does to the page is gated on this.
    function syncActive() {
        return enabled && sessionAlive() && onTargetChannel();
    }

    function isAutoScrolling() {
        return syncActive() && !followPaused && isPlaying();
    }

    function currentVideoTime() {
        if (!videoState) return null;
        if (!isPlaying()) return videoState.timestamp;
        const ageSec = (Date.now() - videoState.sentAt) / 1000;
        return videoState.timestamp + ageSec * (videoState.rate ?? 1);
    }

    function currentOffsetMs() {
        if (!videoState) return 0;
        return config.offsets?.[videoState.title] ?? 0;
    }

    function setCurrentOffsetMs(ms) {
        if (!videoState) return false;
        config.offsets = { ...config.offsets, [videoState.title]: ms };
        saveConfig();
        needsAlign = true;
        settleUntil = Date.now() + 2000;
        return true;
    }

    // Manual override for this episode, else the date Beacon read from the page.
    function effectiveStartMs() {
        if (!videoState) return null;
        const override = config.startOverrides?.[videoState.title];
        return override ?? videoState.streamStartMs ?? null;
    }

    function targetMs() {
        const t = currentVideoTime();
        const start = effectiveStartMs();
        if (t == null || start == null) return null;
        return start + currentOffsetMs() + t * 1000;
    }

    function onTargetChannel() {
        return location.pathname.startsWith(`/channels/${config.guildId}/${config.channelId}`);
    }

    // Loaded messages in DOM order (chronological), with their decoded times.
    function getMessages() {
        const out = [];
        const items = document.querySelectorAll('li[id^="chat-messages-"]');
        for (const el of items) {
            const m = el.id.match(/^chat-messages-(?:\d+-)?(\d+)$/);
            if (m) out.push({ el, time: snowflakeToTime(m[1]) });
        }
        return out;
    }

    function getScroller() {
        const list = document.querySelector('[data-list-id="chat-messages"]');
        let el = list?.parentElement;
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
                return el;
            }
            el = el.parentElement;
        }
        return null;
    }

    // Bottom edge of the area where messages are actually visible,
    // i.e. above the chat input form that overlaps the scroller.
    function getVisibleBottom(scroller) {
        const scrollerBottom = scroller.getBoundingClientRect().bottom;
        const form = document.querySelector('form[class*="formWithLoadedChatInput"]');

        if (!form) return scrollerBottom;

        const formTop = form.getBoundingClientRect().top;
        // Only subtract if the form really overlaps the scroller.
        if (formTop < scrollerBottom) return formTop;

        return scrollerBottom;
    }

    // Put the message's bottom edge at the scroller's bottom edge, like live chat.
    function alignBottom(scroller, el) {
        const delta = el.getBoundingClientRect().bottom - getVisibleBottom(scroller) + 5; //5px offset
        if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    }

    let settleUntil = 0; // keep realigning until this time, e.g. after a seek/jump
    let lastForwardJumpLast = null;
    let jumpSignature = null;   // window contents at the moment of the jump
    let jumpDeadline = 0;

    const signatureOf = (msgs) => msgs[0].el.id + "|" + msgs[msgs.length - 1].el.id;

    function realign() {
        if (!syncActive() || followPaused) return;

        const target = targetMs();
        if (target == null) return;

        const msgs = getMessages();
        if (!msgs.length) return;

        // After a jump, ignore the stale window until Discord swaps in the new messages.
        if (jumpSignature !== null) {
            if (signatureOf(msgs) === jumpSignature && Date.now() < jumpDeadline) return;
            jumpSignature = null;
        }

        let idx = -1;
        for (let i = 0; i < msgs.length; i++) {
            if (msgs[i].time <= target) idx = i;
            else break;
        }
        if (idx === -1) return;

        const scroller = getScroller();
        if (scroller) alignBottom(scroller, msgs[idx].el);
    }

    function tick() {
        updateBadge();
        document.body.classList.toggle("cr-autoscroll", isAutoScrolling());

        if (!onTargetChannel()) {
            followPaused = false;
            needsAlign = true;
        }

        if (!syncActive() || followPaused) return;
        if (!isPlaying() && !needsAlign) return;

        const target = targetMs();
        if (target == null) return;

        const msgs = getMessages();
        if (!msgs.length) return;

        const now = Date.now();
        const gapBefore = pendingSeek ? 0 : GAP_BEFORE_MS;
        const gapAfter = pendingSeek ? 0 : GAP_AFTER_MS;
        const first = msgs[0].time;
        const last = msgs[msgs.length - 1].time;

        const beforeStart = target < first - gapBefore;
        const pastEnd = target > last + gapAfter;
        // Already jumped forward and nothing newer exists: chat is quiet or over, stay put.
        const stuckAtEnd = pastEnd && last === lastForwardJumpLast && !pendingSeek;

        if ((beforeStart || pastEnd) && !stuckAtEnd) {
            if (!pendingSeek && now - lastJumpAt < JUMP_COOLDOWN_MS) return;
            lastJumpAt = now;
            lastForwardJumpLast = pastEnd ? last : null;
            pendingSeek = false;
            settleUntil = now + 2000;
            jumpSignature = signatureOf(msgs);
            jumpDeadline = now + 3000;
            jumpToTime(config.guildId, config.channelId, target);
            return;
        }

        pendingSeek = false;
        settleUntil = Math.max(settleUntil, now + 1500);
        realign();
        needsAlign = false;
    }

    function receiveVideoEvent(event) {
        if (!event || event.source !== "beacon") return;

        if (event.type === "stop") {
            videoState = null;
            followPaused = false;
            console.log("[CR Sync] Session ended");
            return;
        }

        videoState = event;
        if (event.type !== "tick") needsAlign = true; // ticks only keep the session alive

        switch (event.type) {
            case "ready":
            case "seek":
                pendingSeek = true;
                followPaused = false;
                settleUntil = Date.now() + 2000;
                break;
            case "play":
                followPaused = false;
                break;
        }
    }

    /* ------------------------------------------------------------
     * Discord: UI and setup
     * ------------------------------------------------------------ */

    function fmt(sec) {
        sec = Math.max(0, Math.floor(sec));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
    }

    function createBadge() {
        badge = document.createElement("div");
        Object.assign(badge.style, {
            position: "fixed", bottom: "90px", right: "16px", zIndex: 99999,
            padding: "6px 10px", background: "rgba(0,0,0,.75)", color: "#fff",
            font: "12px sans-serif", borderRadius: "6px", cursor: "pointer",
            userSelect: "none",
            whiteSpace: "pre-line",
            maxWidth: "200px",
            lineHeight: "1.4",
            overflowWrap: "break-word",
            textWrap: "balance",          // spread words evenly across the lines
        });

        badge.addEventListener("click", () => {
            if (!enabled) {
                enabled = true;
                needsAlign = true;
            } else if (!onTargetChannel()) {
                // Go straight to the right spot instead of the live end of the channel.
                const t = targetMs();
                if (t != null) {
                    lastJumpAt = Date.now();
                    settleUntil = Date.now() + 2000;
                    jumpToTime(config.guildId, config.channelId, t);
                } else {
                    spaNavigate(`/channels/${config.guildId}/${config.channelId}`);
                }
                followPaused = false;
                needsAlign = true;
            } else if (followPaused) {
                followPaused = false;
                needsAlign = true;
            } else {
                enabled = false;
            }
        });

        document.body.appendChild(badge);
    }

    function updateBadge() {
        if (!badge) return;

        badge.style.display = sessionAlive() ? "" : "none";
        if (!sessionAlive()) return;

        let text;
        if (!enabled) text = "CR Sync: Off\n(click to enable)";
        else if (!onTargetChannel()) text = "CR Sync: Click to\nopen the target channel";
        else if (followPaused) text = "CR Sync: Scrolled away\n(click to resume)";
        else {
            const status = `${fmt(currentVideoTime())} · ${isPlaying() ? "playing" : "paused"}`;
            const guessed = videoState.startSource === "page" ? " · date guessed" : "";
            const off = currentOffsetMs();
            const offText = off ? ` · ${off > 0 ? "+" : ""}${off / 1000}s` : "";
            text = `${videoState.title ?? "CR Sync"}\n${status}${offText}${guessed}`;
        }
        if (badge.textContent !== text) badge.textContent = text;
    }

    // Manual scrolling by the user stops auto-follow until resumed.
    function installUserScrollDetection() {
        const onUser = (e) => {
            if (!syncActive()) return;
            const sc = getScroller();
            if (sc && sc.contains(e.target)) followPaused = true;
        };
        document.addEventListener("wheel", onUser, { passive: true, capture: true });
        document.addEventListener("touchmove", onUser, { passive: true, capture: true });
        document.addEventListener("pointerdown", (e) => {
            if (!syncActive()) return;
            const sc = getScroller();
            if (sc && e.target === sc) followPaused = true; // scrollbar drag
        }, true);
    }

    function setupMenuCommands() {
        GM_registerMenuCommand("Use current channel as sync target", () => {
            const m = location.pathname.match(/^\/channels\/(\d+|@me)\/(\d+)/);
            if (!m) return alert("Open a channel first.");
            config.guildId = m[1];
            config.channelId = m[2];
            saveConfig();
        });

        GM_registerMenuCommand("Set stream start for this episode (UTC, ISO)", () => {
            if (!videoState) return alert("No active sync session.");
            const current = effectiveStartMs();
            const input = prompt(
                "Wall-clock time of video 0:00, e.g. 2026-10-02T02:00:00Z",
                current ? new Date(current).toISOString() : ""
            );
            if (!input) return;
            const ms = Date.parse(input);
            if (Number.isNaN(ms)) return alert("Couldn't parse that date.");
            config.startOverrides = { ...config.startOverrides, [videoState.title]: ms };
            saveConfig();
            pendingSeek = true;
            needsAlign = true;
        });

        GM_registerMenuCommand("Clear stream start override for this episode", () => {
            if (!videoState) return;
            const { [videoState.title]: _removed, ...rest } = config.startOverrides ?? {};
            config.startOverrides = rest;
            saveConfig();
            pendingSeek = true;
            needsAlign = true;
        });

        GM_registerMenuCommand("Set offset for this episode (seconds)", () => {
            if (!videoState) return alert("No active sync session.");
            const input = prompt(
                "Offset in seconds (positive = chat runs later):",
                String(currentOffsetMs() / 1000)
            );
            if (input == null) return;
            const n = Number(input);
            if (Number.isNaN(n)) return alert("Not a number.");
            setCurrentOffsetMs(n * 1000);
            pendingSeek = true; // large changes may need a re-jump
        });

        GM_registerMenuCommand("Nudge +5s", () => {
            if (!videoState) return alert("No active sync session.");
            setCurrentOffsetMs(currentOffsetMs() + 5000);
        });

        GM_registerMenuCommand("Nudge -5s", () => {
            if (!videoState) return alert("No active sync session.");
            setCurrentOffsetMs(currentOffsetMs() - 5000);
        });
    }

    function installLayoutWatchers() {
        let rafPending = false;
        const schedule = () => {
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => { rafPending = false; realign(); });
        };

        // Images, GIFs and videos finishing loading change message heights.
        document.addEventListener("load", (e) => {
            const t = e.target;
            if (t instanceof HTMLImageElement || t instanceof HTMLVideoElement) schedule();
        }, true);
        document.addEventListener("loadedmetadata", schedule, true);

        // Any size change in the message list (embeds expanding, new messages, resizes).
        const ro = new ResizeObserver(schedule);
        let observed = null;
        setInterval(() => {
            const list = document.querySelector('[data-list-id="chat-messages"]');
            if (list && list !== observed) {
                ro.disconnect();
                ro.observe(list);
                observed = list;
            }
        }, 1000);

        // Keep correcting every frame for a short window after a seek or jump.
        (function loop() {
            if (Date.now() < settleUntil) realign();
            requestAnimationFrame(loop);
        })();
    }

    function setupDiscord() {
        console.log("[CR Sync] Discord mode");

        hideChatGradient();

        GM_addValueChangeListener(STATE_KEY, (name, oldValue, newValue, remote) => {
            if (remote) receiveVideoEvent(newValue);
        });

        const currentState = GM_getValue(STATE_KEY, null);
        if (currentState) receiveVideoEvent(currentState);

        createBadge();
        installUserScrollDetection();
        installLayoutWatchers();
        setupMenuCommands();
        setInterval(tick, TICK_MS);

        console.log("[CR Sync] Listening for Beacon events.");
    }

    function hideChatGradient() {
        GM_addStyle(`
            body.cr-autoscroll [class*="chatGradientBase"] {
                display: none !important;
            }
            body.cr-autoscroll [class*="jumpToPresentBar"],
            body.cr-autoscroll [class*="newMessagesBar"] {
                display: none !important;
            }
            body.cr-autoscroll [class*="typing_"] {
                display: none !important;
            }
        `);
    }

    /* ------------------------------------------------------------
     * Start
     * ------------------------------------------------------------ */

    if (isBeacon()) {
        setupBeacon();
    } else if (isDiscord()) {
        setupDiscord();
    }
})();