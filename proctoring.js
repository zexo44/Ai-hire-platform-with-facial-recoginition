/**
 * ============================================================
 * VeriHire AI — Real-Time AI Proctoring Engine
 * ============================================================
 * Provides real face detection, expression analysis, and
 * anti-cheat monitoring using face-api.js in the browser.
 *
 * Features (inspired by Codility, HireVue, HackerEarth):
 * - Real face detection via TinyFaceDetector
 * - Facial expression recognition (7 emotions)
 * - Multi-face detection alerts
 * - Face absence detection
 * - Gaze direction estimation via landmarks
 * - Tab-switch counting
 * - Copy-paste detection
 * - DevTools open detection
 * - Fullscreen exit detection
 * - Violation log with timestamps
 * ============================================================
 */

class ProctoringEngine {
    constructor(options = {}) {
        this.videoElement = options.videoElement || null;
        this.canvasElement = null; // Created internally for face-api overlay
        this.socket = options.socket || null;
        this.isCandidate = options.isCandidate || false;
        this.isRunning = false;
        this.modelsLoaded = false;
        this.detectionInterval = null;

        // Face Detection State
        this.currentExpression = 'Initializing...';
        this.faceDetected = false;
        this.faceCount = 0;
        this.expressionHistory = [];
        this.faceAbsentFrames = 0;
        this.gazeDirection = 'center'; // center, left, right, up, down

        // Anti-Cheat State
        this.violations = [];
        this.tabSwitchCount = 0;
        this.copyPasteCount = 0;
        this.devToolsOpenCount = 0;
        this.fullscreenExitCount = 0;
        this.totalViolations = 0;

        // Timestamps
        this.sessionStartTime = null;
        this.faceAbsentSince = null;

        // Detection thresholds
        this.FACE_ABSENT_THRESHOLD = 10; // frames (~3 seconds at 3fps)
        this.GAZE_AWAY_THRESHOLD = 0.35; // landmark ratio

        // Callbacks
        this.onFaceUpdate = options.onFaceUpdate || (() => {});
        this.onViolation = options.onViolation || (() => {});
        this.onExpressionChange = options.onExpressionChange || (() => {});
        this.onSecurityAlert = options.onSecurityAlert || (() => {});

        // Face-api model URL - using jsdelivr CDN for @vladmandic/face-api
        this.MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';
    }

    /**
     * Load face-api.js models
     */
    async loadModels() {
        if (this.modelsLoaded) return true;

        try {
            console.log('[Proctoring] Loading face detection models...');

            // Check if faceapi is available
            if (typeof faceapi === 'undefined') {
                console.error('[Proctoring] face-api.js not loaded. Include the script tag.');
                return false;
            }

            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(this.MODEL_URL),
                faceapi.nets.faceLandmark68TinyNet.loadFromUri(this.MODEL_URL),
                faceapi.nets.faceExpressionNet.loadFromUri(this.MODEL_URL)
            ]);

            this.modelsLoaded = true;
            console.log('[Proctoring] ✅ All face detection models loaded successfully');
            return true;
        } catch (err) {
            console.error('[Proctoring] Failed to load models:', err);
            return false;
        }
    }

    /**
     * Start the proctoring session
     */
    async start(videoElement) {
        if (videoElement) this.videoElement = videoElement;
        if (!this.videoElement) {
            console.error('[Proctoring] No video element provided');
            return;
        }

        this.sessionStartTime = Date.now();
        this.isRunning = true;

        // Load models if not already loaded
        const loaded = await this.loadModels();
        if (!loaded) {
            console.warn('[Proctoring] Running in degraded mode (no face detection)');
            this._startAntiCheatOnly();
            return;
        }

        // Set up canvas overlay for debugging (optional)
        this._createCanvas();

        // Start detection loop
        this._startDetectionLoop();

        // Start anti-cheat monitoring
        this._startAntiCheatMonitoring();

        console.log('[Proctoring] ✅ Proctoring session started');
    }

    /**
     * Create an overlay canvas for face detection visualization
     */
    _createCanvas() {
        // Remove existing canvas
        if (this.canvasElement) {
            this.canvasElement.remove();
        }

        this.canvasElement = document.createElement('canvas');
        this.canvasElement.style.position = 'absolute';
        this.canvasElement.style.top = '0';
        this.canvasElement.style.left = '0';
        this.canvasElement.style.width = '100%';
        this.canvasElement.style.height = '100%';
        this.canvasElement.style.pointerEvents = 'none';
        this.canvasElement.style.zIndex = '15';

        // Insert canvas as sibling to video
        if (this.videoElement.parentElement) {
            this.videoElement.parentElement.style.position = 'relative';
            this.videoElement.parentElement.appendChild(this.canvasElement);
        }
    }

    /**
     * Main face detection loop using requestAnimationFrame-throttled interval
     */
    _startDetectionLoop() {
        const detect = async () => {
            if (!this.isRunning || !this.videoElement || this.videoElement.paused || this.videoElement.ended) {
                if (this.isRunning) {
                    setTimeout(() => detect(), 500);
                }
                return;
            }

            try {
                const options = new faceapi.TinyFaceDetectorOptions({
                    inputSize: 224,
                    scoreThreshold: 0.4
                });

                const detections = await faceapi
                    .detectAllFaces(this.videoElement, options)
                    .withFaceLandmarks(true) // useTinyModel = true
                    .withFaceExpressions();

                this.faceCount = detections.length;

                if (detections.length === 0) {
                    this._handleFaceAbsent();
                } else if (detections.length > 1) {
                    this._handleMultipleFaces(detections.length);
                } else {
                    // Single face detected — good
                    this._handleFaceDetected(detections[0]);
                }

                // Draw on canvas (subtle overlay)
                if (this.canvasElement && this.videoElement.videoWidth > 0) {
                    const dims = faceapi.matchDimensions(this.canvasElement, {
                        width: this.videoElement.videoWidth,
                        height: this.videoElement.videoHeight
                    });
                    const resizedResults = faceapi.resizeResults(detections, dims);

                    const ctx = this.canvasElement.getContext('2d');
                    ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

                    // Draw subtle face box
                    resizedResults.forEach(det => {
                        const box = det.detection.box;
                        ctx.strokeStyle = this.faceCount === 1 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.8)';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(box.x, box.y, box.width, box.height);
                    });
                }

            } catch (err) {
                // Silently ignore detection failures (e.g., video not ready)
            }

            // Run detection every ~300ms (roughly 3 fps - good for proctoring)
            if (this.isRunning) {
                setTimeout(() => detect(), 300);
            }
        };

        detect();
    }

    /**
     * Handle single face detection
     */
    _handleFaceDetected(detection) {
        this.faceDetected = true;
        this.faceAbsentFrames = 0;
        this.faceAbsentSince = null;

        // Extract dominant expression
        const expressions = detection.expressions;
        const sorted = Object.entries(expressions).sort((a, b) => b[1] - a[1]);
        const topExpression = sorted[0];
        const expressionLabel = this._formatExpression(topExpression[0]);
        const confidence = Math.round(topExpression[1] * 100);

        if (expressionLabel !== this.currentExpression) {
            this.currentExpression = expressionLabel;
            this.onExpressionChange(expressionLabel, confidence);
        }

        // Track expression history
        this.expressionHistory.push({
            expression: topExpression[0],
            confidence: topExpression[1],
            timestamp: Date.now()
        });

        // Keep last 200 entries
        if (this.expressionHistory.length > 200) {
            this.expressionHistory = this.expressionHistory.slice(-200);
        }

        // Analyze gaze direction from landmarks
        if (detection.landmarks) {
            this._analyzeGaze(detection.landmarks);
        }

        // Update HUD
        this.onFaceUpdate({
            faceDetected: true,
            faceCount: 1,
            expression: expressionLabel,
            confidence,
            gazeDirection: this.gazeDirection
        });
    }

    /**
     * Handle face absence
     */
    _handleFaceAbsent() {
        this.faceAbsentFrames++;
        this.faceDetected = false;

        if (this.faceAbsentFrames >= this.FACE_ABSENT_THRESHOLD) {
            if (!this.faceAbsentSince) {
                this.faceAbsentSince = Date.now();
                this._addViolation('face_absent', 'Candidate face not detected');
            }
        }

        this.onFaceUpdate({
            faceDetected: false,
            faceCount: 0,
            expression: 'No Face Detected',
            confidence: 0,
            gazeDirection: 'unknown'
        });
    }

    /**
     * Handle multiple faces detected
     */
    _handleMultipleFaces(count) {
        this.faceDetected = true;
        this.faceAbsentFrames = 0;

        this._addViolation('multiple_faces', `${count} faces detected — possible external assistance`);

        this.onFaceUpdate({
            faceDetected: true,
            faceCount: count,
            expression: `${count} Faces Detected!`,
            confidence: 100,
            gazeDirection: 'unknown'
        });
    }

    /**
     * Analyze gaze direction using facial landmarks
     */
    _analyzeGaze(landmarks) {
        try {
            const positions = landmarks.positions;

            // Nose tip (landmark 30)
            const noseTip = positions[30];
            // Left eye center (average of landmarks 36-41)
            const leftEye = this._averagePoint(positions.slice(36, 42));
            // Right eye center (average of landmarks 42-47)
            const rightEye = this._averagePoint(positions.slice(42, 48));
            // Face center
            const faceCenter = {
                x: (leftEye.x + rightEye.x) / 2,
                y: (leftEye.y + rightEye.y) / 2
            };

            // Eye distance for normalization
            const eyeDist = Math.abs(rightEye.x - leftEye.x);

            // Horizontal offset of nose from face center
            const horizOffset = (noseTip.x - faceCenter.x) / eyeDist;
            // Vertical offset
            const vertOffset = (noseTip.y - faceCenter.y) / eyeDist;

            if (Math.abs(horizOffset) > this.GAZE_AWAY_THRESHOLD) {
                this.gazeDirection = horizOffset > 0 ? 'right' : 'left';
            } else if (vertOffset > this.GAZE_AWAY_THRESHOLD * 1.5) {
                this.gazeDirection = 'down';
            } else {
                this.gazeDirection = 'center';
            }
        } catch(e) {
            this.gazeDirection = 'center';
        }
    }

    _averagePoint(points) {
        const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: sum.x / points.length, y: sum.y / points.length };
    }

    /**
     * Format expression name for display
     */
    _formatExpression(raw) {
        const map = {
            'neutral': 'Neutral',
            'happy': 'Confident',
            'sad': 'Concerned',
            'angry': 'Frustrated',
            'fearful': 'Anxious',
            'disgusted': 'Uncomfortable',
            'surprised': 'Surprised'
        };
        return map[raw] || raw;
    }

    // ========================================================
    // ANTI-CHEAT SYSTEM
    // ========================================================

    _startAntiCheatMonitoring() {
        this._monitorTabSwitch();
        this._monitorCopyPaste();
        this._monitorDevTools();
        this._monitorFullscreen();
        this._monitorRightClick();
    }

    _startAntiCheatOnly() {
        this.isRunning = true;
        this._startAntiCheatMonitoring();
    }

    /**
     * Monitor tab/window visibility changes
     */
    _monitorTabSwitch() {
        this._visibilityHandler = () => {
            if (!this.isRunning) return;

            if (document.visibilityState === 'hidden') {
                this.tabSwitchCount++;
                this._addViolation('tab_switch', `Tab switched (count: ${this.tabSwitchCount})`);

                // Emit to interviewer
                if (this.socket && this.isCandidate) {
                    this.socket.emit('security-alert', {
                        type: 'focus',
                        status: 'away',
                        count: this.tabSwitchCount
                    });
                }
            } else {
                if (this.socket && this.isCandidate) {
                    this.socket.emit('security-alert', {
                        type: 'focus',
                        status: 'active',
                        count: this.tabSwitchCount
                    });
                }
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    /**
     * Monitor copy-paste events
     */
    _monitorCopyPaste() {
        this._copyHandler = (e) => {
            if (!this.isRunning) return;
            this.copyPasteCount++;
            this._addViolation('copy_paste', `Copy/Paste detected (count: ${this.copyPasteCount})`);

            if (this.socket && this.isCandidate) {
                this.socket.emit('security-alert', {
                    type: 'clipboard',
                    action: e.type,
                    count: this.copyPasteCount
                });
            }
        };

        document.addEventListener('copy', this._copyHandler);
        document.addEventListener('paste', this._copyHandler);
        document.addEventListener('cut', this._copyHandler);
    }

    /**
     * Monitor for DevTools opening (window resize heuristic)
     */
    _monitorDevTools() {
        this._devtoolsThreshold = 160;
        this._devtoolsHandler = () => {
            if (!this.isRunning) return;

            const widthDiff = window.outerWidth - window.innerWidth;
            const heightDiff = window.outerHeight - window.innerHeight;

            if (widthDiff > this._devtoolsThreshold || heightDiff > this._devtoolsThreshold) {
                this.devToolsOpenCount++;
                this._addViolation('devtools', `DevTools may be open (count: ${this.devToolsOpenCount})`);

                if (this.socket && this.isCandidate) {
                    this.socket.emit('security-alert', {
                        type: 'devtools',
                        status: 'detected',
                        count: this.devToolsOpenCount
                    });
                }
            }
        };

        this._devtoolsInterval = setInterval(this._devtoolsHandler, 3000);
    }

    /**
     * Monitor fullscreen exit
     */
    _monitorFullscreen() {
        this._fullscreenHandler = () => {
            if (!this.isRunning) return;

            if (!document.fullscreenElement) {
                this.fullscreenExitCount++;
                this._addViolation('fullscreen_exit', `Exited fullscreen (count: ${this.fullscreenExitCount})`);

                if (this.socket && this.isCandidate) {
                    this.socket.emit('security-alert', {
                        type: 'fullscreen',
                        status: 'exited',
                        count: this.fullscreenExitCount
                    });
                }
            }
        };

        document.addEventListener('fullscreenchange', this._fullscreenHandler);
    }

    /**
     * Disable right-click during proctored session
     */
    _monitorRightClick() {
        this._contextMenuHandler = (e) => {
            if (!this.isRunning) return;
            e.preventDefault();
            this._addViolation('right_click', 'Right-click attempt blocked');
        };
        document.addEventListener('contextmenu', this._contextMenuHandler);
    }

    // ========================================================
    // VIOLATION MANAGEMENT
    // ========================================================

    _addViolation(type, message) {
        const violation = {
            type,
            message,
            timestamp: Date.now(),
            timeSinceStart: this.sessionStartTime ? Date.now() - this.sessionStartTime : 0
        };

        this.violations.push(violation);
        this.totalViolations++;

        console.warn(`[Proctoring] ⚠️ VIOLATION: ${message}`);
        this.onViolation(violation);
        this.onSecurityAlert(violation);
    }

    // ========================================================
    // SESSION REPORT
    // ========================================================

    /**
     * Generate a comprehensive proctoring report for AI analysis
     */
    generateReport() {
        const duration = this.sessionStartTime ? (Date.now() - this.sessionStartTime) / 1000 : 0;

        // Calculate expression distribution
        const expressionDist = {};
        this.expressionHistory.forEach(entry => {
            const exp = entry.expression;
            expressionDist[exp] = (expressionDist[exp] || 0) + 1;
        });

        // Normalize
        const totalExpressions = this.expressionHistory.length || 1;
        Object.keys(expressionDist).forEach(key => {
            expressionDist[key] = Math.round((expressionDist[key] / totalExpressions) * 100);
        });

        // Calculate integrity score (100 = perfect, 0 = worst)
        let integrityScore = 100;
        integrityScore -= this.tabSwitchCount * 8;
        integrityScore -= this.copyPasteCount * 5;
        integrityScore -= this.devToolsOpenCount * 15;
        integrityScore -= this.fullscreenExitCount * 3;
        integrityScore -= this.violations.filter(v => v.type === 'face_absent').length * 10;
        integrityScore -= this.violations.filter(v => v.type === 'multiple_faces').length * 20;
        integrityScore = Math.max(0, Math.min(100, integrityScore));

        return {
            sessionDuration: Math.round(duration),
            integrityScore,
            faceDetection: {
                totalFramesAnalyzed: this.expressionHistory.length,
                faceAbsentViolations: this.violations.filter(v => v.type === 'face_absent').length,
                multipleFaceViolations: this.violations.filter(v => v.type === 'multiple_faces').length,
                expressionDistribution: expressionDist,
                dominantExpression: Object.entries(expressionDist).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown'
            },
            antiCheat: {
                tabSwitchCount: this.tabSwitchCount,
                copyPasteCount: this.copyPasteCount,
                devToolsDetected: this.devToolsOpenCount,
                fullscreenExits: this.fullscreenExitCount
            },
            violations: this.violations.map(v => ({
                type: v.type,
                message: v.message,
                timeIntoSession: Math.round(v.timeSinceStart / 1000) + 's'
            })),
            totalViolations: this.totalViolations
        };
    }

    // ========================================================
    // CLEANUP
    // ========================================================

    stop() {
        this.isRunning = false;

        if (this.canvasElement) {
            this.canvasElement.remove();
            this.canvasElement = null;
        }

        if (this._devtoolsInterval) {
            clearInterval(this._devtoolsInterval);
        }

        document.removeEventListener('visibilitychange', this._visibilityHandler);
        document.removeEventListener('copy', this._copyHandler);
        document.removeEventListener('paste', this._copyHandler);
        document.removeEventListener('cut', this._copyHandler);
        document.removeEventListener('fullscreenchange', this._fullscreenHandler);
        document.removeEventListener('contextmenu', this._contextMenuHandler);

        console.log('[Proctoring] Session stopped');
    }
}

// Export for browser
window.ProctoringEngine = ProctoringEngine;
