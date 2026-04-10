document.addEventListener('DOMContentLoaded', () => {
    // Initialize icons
    lucide.createIcons();

    // ========================================================
    // DOM REFERENCES
    // ========================================================
    const form = document.getElementById('analysis-form');
    const inputView = document.getElementById('input-view');
    const loadingView = document.getElementById('loading-view');
    const resultsView = document.getElementById('results-view');
    const liveView = document.getElementById('live-interview-view');
    
    const btnNew = document.getElementById('btn-new-analysis');
    const pageTitle = document.getElementById('page-title');
    const navDashboard = document.getElementById('nav-dashboard');
    const navLive = document.getElementById('nav-live');
    const navAdmin = document.getElementById('nav-admin');
    const adminView = document.getElementById('admin-view');

    const urlParams = new URLSearchParams(window.location.search);
    const isCandidate = urlParams.get('role') === 'candidate';
    const roomParam = urlParams.get('room');

    const landingPage = document.getElementById('landing-page');
    const ctaBtns = document.querySelectorAll('.cta-login-btn');
    const welcomeScreen = document.getElementById('welcome-screen');
    const appContainer = document.getElementById('app-container');
    const loginForm = document.getElementById('login-form');
    const btnLogin = document.getElementById('btn-login');

    // ========================================================
    // INTERSECTION OBSERVER — Reveal animations
    // ========================================================
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
            }
        });
    }, { threshold: 0.15 });

    document.querySelectorAll('.reveal').forEach((el) => {
        observer.observe(el);
    });

    // ========================================================
    // LANDING PAGE → APP TRANSITION
    // ========================================================
    if (landingPage) {
        ctaBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                landingPage.classList.add('cinematic-exit');
                setTimeout(() => {
                    landingPage.style.display = 'none';
                    if (welcomeScreen) {
                        welcomeScreen.style.display = 'flex';
                        const panel = welcomeScreen.querySelector('.glass-panel');
                        if (panel) {
                            panel.style.animation = 'none';
                            panel.offsetHeight;
                            panel.style.animation = 'slide-up-fade 1s cubic-bezier(0.16, 1, 0.3, 1) forwards';
                        }
                    }
                }, 900);
            });
        });
    }

    const candidateLobby = document.getElementById('candidate-lobby');
    const btnJoinRoom = document.getElementById('btn-join-room');

    if (isCandidate) {
        if (landingPage) landingPage.style.display = 'none';
        document.body.classList.add('candidate-mode');
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        if (appContainer) {
            appContainer.style.opacity = '0';
            appContainer.classList.remove('entered');
        }
        if (candidateLobby) candidateLobby.style.display = 'flex';
        
        hideAllViews();
        liveView.style.display = 'block';

        if (btnJoinRoom) {
            btnJoinRoom.addEventListener('click', () => {
                candidateLobby.style.display = 'none';
                appContainer.classList.add('entered');
            });
        }
    } else {
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const originalText = btnLogin.innerHTML;
                btnLogin.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Authenticating...';
                lucide.createIcons();
                
                setTimeout(() => {
                    if (welcomeScreen) welcomeScreen.classList.add('fade-out');
                    if (appContainer) appContainer.classList.add('entered');
                    setTimeout(() => { btnLogin.innerHTML = originalText; welcomeScreen.style.display = 'none'; }, 800);
                }, 1200);
            });
        }
    }

    // ========================================================
    // NAV SWITCHING
    // ========================================================
    function hideAllViews() {
        inputView.style.display = 'none';
        loadingView.style.display = 'none';
        resultsView.style.display = 'none';
        liveView.style.display = 'none';
        if (adminView) adminView.style.display = 'none';
        
        navDashboard.classList.remove('active');
        if (navLive) navLive.classList.remove('active');
        if (navAdmin) navAdmin.classList.remove('active');
    }

    if (navAdmin) {
        navAdmin.addEventListener('click', (e) => {
            e.preventDefault();
            hideAllViews();
            navAdmin.classList.add('active');
            adminView.style.display = 'block';
            pageTitle.innerText = "Admin & Billing";
        });
    }

    navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        hideAllViews();
        navDashboard.classList.add('active');
        inputView.style.display = 'block';
        pageTitle.innerText = "New Candidate Analysis";
    });

    if (navLive) {
        navLive.addEventListener('click', (e) => {
            e.preventDefault();
            hideAllViews();
            navLive.classList.add('active');
            liveView.style.display = 'block';
            pageTitle.innerText = "Live Interview Mode";
        });
    }

    // ========================================================
    // MANUAL ANALYSIS FORM
    // ========================================================
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const jobRole = document.getElementById('jobRole').value;
        const requiredSkills = document.getElementById('requiredSkills').value;
        const toneIndicator = document.getElementById('toneIndicator').value;
        const candidateAnswers = document.getElementById('candidateAnswers').value;

        await processAnalysis(jobRole, requiredSkills, toneIndicator, candidateAnswers, inputView, null);
    });

    btnNew.addEventListener('click', () => {
        hideAllViews();
        navDashboard.classList.add('active');
        inputView.style.display = 'block';
        pageTitle.innerText = "New Candidate Analysis";
        document.getElementById('candidateAnswers').value = '';
    });

    // ========================================================
    // SOCKET.IO CONNECTION
    // ========================================================
    const socket = typeof io !== 'undefined' ? io() : null;

    // ========================================================
    // WEBRTC MANAGER INSTANCE
    // ========================================================
    let webrtcManager = null;

    // ========================================================
    // PROCTORING ENGINE INSTANCE
    // ========================================================
    let proctoringEngine = null;

    // ========================================================
    // LIVE INTERVIEW — DOM REFERENCES
    // ========================================================
    const video = document.getElementById('webcam-feed');
    const remoteVideo = document.getElementById('remote-video');
    const placeholder = document.getElementById('camera-placeholder');
    const btnStart = document.getElementById('btn-start-interview');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnCopyLink = document.getElementById('btn-copy-link');
    const roomDisplay = document.getElementById('room-id-display');
    const btnEnd = document.getElementById('btn-end-interview');
    const indicator = document.getElementById('recording-indicator');
    const facialOverlay = document.getElementById('facial-overlay');
    const facialStatus = document.getElementById('facial-status');
    const transcriptBox = document.getElementById('live-transcript');
    const btnScreenShare = document.getElementById('btn-screen-share');
    const btnDownloadRec = document.getElementById('btn-download-recording');
    const activeControls = document.getElementById('active-interview-controls');
    const connectionBadge = document.getElementById('connection-badge');
    const connectionText = document.getElementById('connection-text');
    const violationLogCard = document.getElementById('violation-log-card');
    const violationLog = document.getElementById('violation-log');

    // HUD elements
    const hudFaceText = document.getElementById('hud-face-text');
    const hudFaceDot = document.getElementById('hud-face');
    const hudFaceBadge = document.getElementById('hud-face-badge');
    const hudExprText = document.getElementById('hud-expression-text');
    const hudExprDot = document.getElementById('hud-expr');
    const hudExprBadge = document.getElementById('hud-expression-badge');
    const hudFocusText = document.getElementById('hud-focus-text');
    const hudFocusDot = document.getElementById('hud-focus');
    const hudFocusBadge = document.getElementById('hud-focus-badge');
    const hudViolText = document.getElementById('hud-violations-text');
    const hudViolDot = document.getElementById('hud-viol');
    const hudNetworkText = document.getElementById('hud-network-text');

    let currentRoom = null;
    let stream = null;
    let recognition = null;
    let finalTranscript = '';
    let isRecording = false;
    let mediaRecorder = null;
    let recordedChunks = [];
    let lastProctoringReport = null;

    // ========================================================
    // WEB SPEECH API
    // ========================================================
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let newlyFinal = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    newlyFinal += event.results[i][0].transcript + ' ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            if (isRecording) {
                if (isCandidate && newlyFinal.trim().length > 0 && socket) {
                    socket.emit('candidate-transcript', newlyFinal);
                } else if (!isCandidate) {
                    finalTranscript += newlyFinal;
                    transcriptBox.innerHTML = finalTranscript + '<br><i style="color:#64748b;">' + interimTranscript + '</i>';
                    transcriptBox.scrollTop = transcriptBox.scrollHeight;
                }
            }
        };
        recognition.onerror = (e) => console.log("[Speech] Config issue: ", e.error);
    }

    // ========================================================
    // WEBRTC MANAGER SETUP
    // ========================================================
    function initWebRTCManager() {
        if (!socket) return;

        webrtcManager = new WebRTCManager(socket, {
            onRemoteStream: (remoteStream) => {
                remoteVideo.srcObject = remoteStream;
                remoteVideo.style.display = 'block';
                placeholder.style.display = 'none';
            },
            onConnectionStateChange: (state) => {
                updateConnectionBadge(state);
            },
            onNetworkQuality: (quality) => {
                updateNetworkHUD(quality);
            },
            onDisconnected: (role) => {
                remoteVideo.style.display = 'none';
                placeholder.style.display = 'block';
                placeholder.innerHTML = '<i data-lucide="user-x"></i><p>' + role + ' disconnected.</p>';
                lucide.createIcons();
            },
            onReconnecting: (attempt) => {
                updateConnectionBadge('reconnecting');
                if (connectionText) connectionText.textContent = `Reconnecting (${attempt})...`;
            },
            onError: (type, err) => {
                console.error(`[WebRTC] Error (${type}):`, err);
            }
        });
    }

    function updateConnectionBadge(state) {
        if (!connectionBadge) return;
        connectionBadge.style.display = 'inline-flex';
        connectionBadge.className = 'connection-badge';

        switch(state) {
            case 'connected':
                connectionBadge.classList.add('connected');
                connectionText.textContent = 'Connected';
                break;
            case 'disconnected':
            case 'reconnecting':
                connectionBadge.classList.add('connecting');
                connectionText.textContent = 'Reconnecting...';
                break;
            case 'failed':
                connectionBadge.classList.add('failed');
                connectionText.textContent = 'Connection Failed';
                break;
            default:
                connectionText.textContent = 'Connecting...';
        }
    }

    function updateNetworkHUD(quality) {
        if (!hudNetworkText) return;
        const bars = document.querySelectorAll('.net-bar');
        bars.forEach(b => { b.classList.remove('active', 'poor', 'good'); });

        const activeCount = quality.level === 'excellent' ? 4 : quality.level === 'good' ? 3 : 1;
        const colorClass = quality.level === 'poor' ? 'poor' : quality.level === 'good' ? 'good' : '';

        bars.forEach((b, i) => {
            if (i < activeCount) {
                b.classList.add('active');
                if (colorClass) b.classList.add(colorClass);
            }
        });

        hudNetworkText.textContent = `Net: ${quality.bitrate}kbps ${quality.level === 'poor' ? '⚠️' : ''}`;
    }

    // ========================================================
    // PROCTORING ENGINE SETUP
    // ========================================================
    function initProctoringEngine() {
        proctoringEngine = new ProctoringEngine({
            videoElement: isCandidate ? video : remoteVideo,
            socket: socket,
            isCandidate: isCandidate,
            onFaceUpdate: (data) => {
                if (isCandidate) return; // Only show HUD on interviewer side
                updateFaceHUD(data);
            },
            onExpressionChange: (expression, confidence) => {
                if (facialStatus) {
                    facialStatus.textContent = `Expression: ${expression} (${confidence}%)`;
                }
            },
            onViolation: (violation) => {
                if (!isCandidate) {
                    addViolationToLog(violation);
                    showAlertFlash(violation.message);
                    updateViolationHUD();
                }
            },
            onSecurityAlert: (alert) => {
                // Already handled by socket relay
            }
        });
    }

    function updateFaceHUD(data) {
        if (!hudFaceText) return;

        // Face detection
        if (data.faceCount === 0) {
            hudFaceText.textContent = 'Face: NOT DETECTED';
            hudFaceDot.className = 'status-dot status-red';
            hudFaceBadge.className = 'hud-badge danger-state';
        } else if (data.faceCount > 1) {
            hudFaceText.textContent = `Face: ${data.faceCount} DETECTED!`;
            hudFaceDot.className = 'status-dot status-red';
            hudFaceBadge.className = 'hud-badge danger-state';
        } else {
            hudFaceText.textContent = 'Face: Confirmed';
            hudFaceDot.className = 'status-dot status-green';
            hudFaceBadge.className = 'hud-badge';
        }

        // Expression
        if (hudExprText && data.expression) {
            hudExprText.textContent = `Expr: ${data.expression}`;
        }

        // Gaze
        if (data.gazeDirection && data.gazeDirection !== 'center' && data.gazeDirection !== 'unknown') {
            hudExprDot.className = 'status-dot status-yellow';
            hudExprBadge.className = 'hud-badge warning-state';
        } else if (data.faceDetected) {
            hudExprDot.className = 'status-dot status-green';
            hudExprBadge.className = 'hud-badge';
        }
    }

    function updateViolationHUD() {
        if (!proctoringEngine || !hudViolText) return;
        const count = proctoringEngine.totalViolations;
        hudViolText.textContent = `Violations: ${count}`;

        if (count > 5) {
            hudViolDot.className = 'status-dot status-red';
        } else if (count > 0) {
            hudViolDot.className = 'status-dot status-yellow';
        } else {
            hudViolDot.className = 'status-dot status-green';
        }
    }

    function addViolationToLog(violation) {
        if (!violationLog || !violationLogCard) return;
        violationLogCard.style.display = 'flex';

        // Remove placeholder
        const em = violationLog.querySelector('em');
        if (em) em.remove();

        const timeStr = new Date(violation.timestamp).toLocaleTimeString();
        const isWarning = violation.type === 'tab_switch' || violation.type === 'fullscreen_exit';

        const entry = document.createElement('div');
        entry.className = `violation-entry ${isWarning ? 'warning' : ''}`;
        entry.innerHTML = `<span class="violation-time">${timeStr}</span><span class="violation-msg">${violation.message}</span>`;
        violationLog.appendChild(entry);
        violationLog.scrollTop = violationLog.scrollHeight;
    }

    function showAlertFlash(message) {
        const overlay = document.getElementById('proctoring-alert-overlay');
        const text = document.getElementById('proctoring-alert-text');
        if (!overlay) return;

        text.textContent = message;
        overlay.style.display = 'flex';
        lucide.createIcons();

        setTimeout(() => {
            overlay.style.display = 'none';
        }, 2500);
    }

    // ========================================================
    // SOCKET.IO — Security Alert Receiver (Interviewer side)
    // ========================================================
    if (socket && !isCandidate) {
        socket.on('security-alert', (data) => {
            if (data.type === 'focus') {
                if (data.status === 'away') {
                    hudFocusText.textContent = `Tab Focus: AWAY! (${data.count || 1}x)`;
                    hudFocusDot.className = 'status-dot status-red';
                    hudFocusBadge.className = 'hud-badge danger-state';
                    addViolationToLog({
                        type: 'tab_switch',
                        message: `Candidate switched tabs (${data.count || 1}x)`,
                        timestamp: Date.now()
                    });
                    showAlertFlash(`Tab Switch Detected! (${data.count || 1}x)`);
                    updateViolationHUD();
                } else {
                    hudFocusText.textContent = 'Tab Focus: Active';
                    hudFocusDot.className = 'status-dot status-green';
                    hudFocusBadge.className = 'hud-badge';
                }
            }
            if (data.type === 'clipboard') {
                addViolationToLog({
                    type: 'copy_paste',
                    message: `Copy/paste detected (${data.count || 1}x)`,
                    timestamp: Date.now()
                });
                showAlertFlash('Clipboard Activity Detected!');
                updateViolationHUD();
            }
            if (data.type === 'devtools') {
                addViolationToLog({
                    type: 'devtools',
                    message: 'DevTools may be open',
                    timestamp: Date.now()
                });
                showAlertFlash('DevTools Detected!');
                updateViolationHUD();
            }
        });

        socket.on('candidate-transcript', (text) => {
            finalTranscript += text + ' ';
            if (transcriptBox) {
                transcriptBox.innerHTML = finalTranscript;
                transcriptBox.scrollTop = transcriptBox.scrollHeight;
            }
        });

        socket.on('code-change', (code) => {
            const ide = document.getElementById('code-editor');
            if (ide && ide.value !== code) {
                ide.value = code;
            }
        });
    }

    // ========================================================
    // IDE TOGGLE
    // ========================================================
    const btnToggleIde = document.getElementById('btn-toggle-ide');
    const liveIde = document.getElementById('live-ide');
    const mainGrid = document.getElementById('main-interview-grid');
    if (btnToggleIde && liveIde) {
        btnToggleIde.addEventListener('click', () => {
            liveIde.classList.toggle('active');
            if (liveIde.classList.contains('active')) {
                mainGrid.style.gridTemplateColumns = '1.2fr 1.5fr 0.8fr';
            } else {
                mainGrid.style.gridTemplateColumns = '2fr 1fr';
            }
        });
    }

    // IDE Transmitter
    const codeEditorDom = document.getElementById('code-editor');
    if (codeEditorDom) {
        codeEditorDom.addEventListener('input', (e) => {
            if (socket && currentRoom) {
                socket.emit('code-change', e.target.value);
            }
        });
    }

    // ========================================================
    // ROOM CREATION & JOINING
    // ========================================================
    if (btnCreateRoom) {
        btnCreateRoom.addEventListener('click', async () => {
            currentRoom = Math.random().toString(36).substring(2, 8);
            btnCreateRoom.style.display = 'none';
            roomDisplay.innerText = "Room: " + currentRoom;
            roomDisplay.style.display = 'inline-flex';
            btnCopyLink.style.display = 'inline-flex';

            // Initialize WebRTC Manager
            initWebRTCManager();
            if (webrtcManager) {
                await webrtcManager.joinRoom(currentRoom, 'interviewer');
            }
        });

        btnCopyLink.addEventListener('click', () => {
            const link = window.location.origin + window.location.pathname + '?room=' + currentRoom + '&role=candidate';
            navigator.clipboard.writeText(link);
            btnCopyLink.innerHTML = '<i data-lucide="check"></i> Copied!';
            setTimeout(() => {
                btnCopyLink.innerHTML = '<i data-lucide="copy"></i> Copy Candidate Link';
                lucide.createIcons();
            }, 2000);
            lucide.createIcons();
        });
    }

    // Candidate auto-join
    if (isCandidate && roomParam) {
        currentRoom = roomParam;

        if (btnJoinRoom) {
            btnJoinRoom.addEventListener('click', async () => {
                initWebRTCManager();
                if (webrtcManager) {
                    await webrtcManager.joinRoom(currentRoom, 'candidate');
                }
                setTimeout(() => { if (btnStart) btnStart.click(); }, 500);
            });
        }
    }

    // ========================================================
    // SCREEN SHARE
    // ========================================================
    if (btnScreenShare) {
        let isSharing = false;
        btnScreenShare.addEventListener('click', async () => {
            if (!webrtcManager) return;

            if (!isSharing) {
                const screenStream = await webrtcManager.startScreenShare();
                if (screenStream) {
                    isSharing = true;
                    btnScreenShare.innerHTML = '<i data-lucide="monitor-off"></i> Stop Share';
                    lucide.createIcons();
                }
            } else {
                await webrtcManager.stopScreenShare();
                isSharing = false;
                btnScreenShare.innerHTML = '<i data-lucide="monitor"></i> Share Screen';
                lucide.createIcons();
            }
        });
    }

    // ========================================================
    // RECORDING (MediaRecorder)
    // ========================================================
    function startRecording(mediaStream) {
        try {
            recordedChunks = [];
            const options = { mimeType: 'video/webm;codecs=vp9,opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'video/webm';
            }
            mediaRecorder = new MediaRecorder(mediaStream, options);
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };
            mediaRecorder.start(1000); // chunk every second
            console.log('[Recording] Started');
        } catch (e) {
            console.warn('[Recording] MediaRecorder not available:', e);
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            console.log('[Recording] Stopped');
        }
    }

    if (btnDownloadRec) {
        btnDownloadRec.addEventListener('click', () => {
            if (recordedChunks.length === 0) {
                alert('No recording available yet.');
                return;
            }
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `interview-${currentRoom || 'session'}-${Date.now()}.webm`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // ========================================================
    // START / END INTERVIEW
    // ========================================================
    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            try {
                // Get local media
                if (webrtcManager) {
                    stream = await webrtcManager.getLocalStream();
                } else {
                    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                }

                video.srcObject = stream;
                video.style.display = 'block';
                placeholder.style.display = 'none';
                btnStart.style.display = 'none';
                btnEnd.style.display = 'flex';
                indicator.style.display = 'inline-flex';
                facialOverlay.style.display = 'flex';
                if (activeControls) activeControls.style.display = 'flex';

                if (!isCandidate) {
                    const hud = document.getElementById('security-hud');
                    if (hud) hud.style.display = 'flex';
                }

                isRecording = true;
                finalTranscript = '';
                transcriptBox.innerHTML = '';

                // Start speech recognition
                if (recognition) {
                    try { recognition.start(); } catch(e) {}
                } else {
                    transcriptBox.innerHTML = "<em>(Speech recognition not supported. Mock data will appear.)</em>";
                    setTimeout(() => { if(isRecording) { finalTranscript += "I have extensive experience with Node.js and AWS infrastructure. "; transcriptBox.innerHTML = finalTranscript; } }, 3000);
                    setTimeout(() => { if(isRecording) { finalTranscript += "I've built horizontally scaled systems using caching and microservices. "; transcriptBox.innerHTML = finalTranscript; } }, 8000);
                }

                // Start proctoring
                initProctoringEngine();
                if (proctoringEngine) {
                    // For interviewer, proctor the remote video; for candidate, proctor local video
                    const targetVideo = isCandidate ? video : (remoteVideo.srcObject ? remoteVideo : video);
                    proctoringEngine.start(targetVideo);
                }

                // Start recording
                startRecording(stream);

                lucide.createIcons();

            } catch (err) {
                console.error("Camera error:", err);
                alert("Camera/Mic restricted. Switching to Simulated Mode!");
                
                video.style.display = 'none';
                placeholder.innerHTML = '<i data-lucide="monitor-off"></i><p class="mt-2 text-sm text-center">Simulated Camera Mode<br>(Requires Localhost)</p>';
                placeholder.style.display = 'flex';
                placeholder.style.flexDirection = 'column';
                
                btnStart.style.display = 'none';
                btnEnd.style.display = 'flex';
                indicator.style.display = 'inline-flex';
                facialOverlay.style.display = 'flex';
                if (activeControls) activeControls.style.display = 'flex';
                
                if (!isCandidate) {
                    const hud = document.getElementById('security-hud');
                    if (hud) hud.style.display = 'flex';
                }
                
                isRecording = true;
                finalTranscript = '';
                transcriptBox.innerHTML = "<em>(Simulated Mode Active. Generating mock speech...)</em>";
                
                setTimeout(() => { if(isRecording) { finalTranscript += "I have extensive experience with Node.js and AWS infrastructure. "; transcriptBox.innerHTML = finalTranscript; } }, 3000);
                setTimeout(() => { if(isRecording) { finalTranscript += "I've built horizontally scaled systems using caching and microservices. "; transcriptBox.innerHTML = finalTranscript; } }, 8000);

                // Still start proctoring anti-cheat even in simulated mode
                initProctoringEngine();
                if (proctoringEngine) {
                    proctoringEngine._startAntiCheatOnly();
                }
                
                lucide.createIcons();
            }
        });

        // END INTERVIEW
        btnEnd.addEventListener('click', async () => {
            isRecording = false;

            // Stop recording
            stopRecording();

            // Stop speech
            if (recognition) {
                try { recognition.stop(); } catch(e) {}
            }

            // Generate proctoring report
            if (proctoringEngine) {
                lastProctoringReport = proctoringEngine.generateReport();
                proctoringEngine.stop();
                console.log('[Proctoring] Report:', lastProctoringReport);
            }

            // Stop media
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                video.srcObject = null;
            }

            video.style.display = 'none';
            placeholder.style.display = 'block';
            btnStart.style.display = 'flex';
            btnEnd.style.display = 'none';
            indicator.style.display = 'none';
            facialOverlay.style.display = 'none';

            // Show proctoring modal if we have a report
            if (lastProctoringReport) {
                showProctoringModal(lastProctoringReport);
            } else {
                // No proctoring data — go straight to analysis
                const role = document.getElementById('liveJobRole').value;
                const skills = document.getElementById('liveSkills').value;
                const textToAnalyze = finalTranscript.trim() || "No transcript collected during the session.";
                await processAnalysis(role, skills, 'confident', textToAnalyze, liveView, null);
            }
        });
    }

    // ========================================================
    // PROCTORING SUMMARY MODAL
    // ========================================================
    function showProctoringModal(report) {
        const modal = document.getElementById('proctoring-modal');
        if (!modal) return;

        // Fill in data
        const scoreEl = document.getElementById('modal-integrity-score');
        const ring = document.querySelector('.integrity-ring');
        scoreEl.textContent = report.integrityScore;

        ring.className = 'integrity-ring';
        if (report.integrityScore < 50) ring.classList.add('danger-ring');
        else if (report.integrityScore < 80) ring.classList.add('warning-ring');

        document.getElementById('modal-tab-switches').textContent = report.antiCheat.tabSwitchCount;
        document.getElementById('modal-copy-paste').textContent = report.antiCheat.copyPasteCount;
        document.getElementById('modal-face-absent').textContent = report.faceDetection.faceAbsentViolations;
        document.getElementById('modal-multi-face').textContent = report.faceDetection.multipleFaceViolations;
        document.getElementById('modal-devtools').textContent = report.antiCheat.devToolsDetected;
        document.getElementById('modal-expression').textContent = report.faceDetection.dominantExpression || 'N/A';

        // Highlight violations
        document.querySelectorAll('.modal-stat').forEach(stat => {
            const val = parseInt(stat.querySelector('.modal-stat-value').textContent);
            if (val > 0 && stat.querySelector('.modal-stat-label').textContent !== 'Dominant Expression') {
                stat.classList.add('has-violations');
            } else {
                stat.classList.remove('has-violations');
            }
        });

        modal.style.display = 'flex';
        lucide.createIcons();

        // Proceed button
        const btnProceed = document.getElementById('btn-proceed-analysis');
        btnProceed.onclick = async () => {
            modal.style.display = 'none';

            const role = document.getElementById('liveJobRole').value;
            const skills = document.getElementById('liveSkills').value;
            const textToAnalyze = finalTranscript.trim() || "No transcript collected during the session.";

            // Determine tone from expression data
            let avgTone = 'confident';
            if (report.faceDetection.dominantExpression) {
                const expr = report.faceDetection.dominantExpression;
                if (expr === 'fearful' || expr === 'sad') avgTone = 'nervous';
                else if (expr === 'neutral') avgTone = 'confident';
                else if (expr === 'angry') avgTone = 'arrogant';
            }

            await processAnalysis(role, skills, avgTone, textToAnalyze, liveView, lastProctoringReport);
        };
    }

    // ========================================================
    // SHARED ANALYSIS FLOW — Now with proctoring data
    // ========================================================
    async function processAnalysis(jobRole, requiredSkills, toneIndicator, answers, currentView, proctoringReport) {
        currentView.style.display = 'none';
        loadingView.style.display = 'block';
        pageTitle.innerText = "Analyzing Responses...";
        animateLoadingSteps();

        try {
            const results = await window.AIEngine.analyze(jobRole, requiredSkills, toneIndicator, answers, proctoringReport);
            populateResults(results, jobRole);
            
            loadingView.style.display = 'none';
            resultsView.style.display = 'block';
            pageTitle.innerText = "Analysis Complete";
            lucide.createIcons();
            
            setTimeout(() => {
                const circle = document.getElementById('score-circle-path');
                circle.setAttribute('stroke-dasharray', `${results.finalScore.score}, 100`);
            }, 100);
        } catch (error) {
            console.error("Analysis failed", error);
            alert("An error occurred during analysis.");
            currentView.style.display = 'block';
            loadingView.style.display = 'none';
        }
    }

    function animateLoadingSteps() {
        const step1 = document.getElementById('step-1');
        const step2 = document.getElementById('step-2');
        const step3 = document.getElementById('step-3');

        step1.className = 'active'; step1.innerHTML = '<i data-lucide="check-circle-2"></i> Extracting claims & skills';
        step2.className = ''; step2.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Mapping text to behavioral models';
        step3.className = 'text-muted'; step3.innerHTML = '<i data-lucide="circle"></i> Running Authenticity & Integrity checks';
        lucide.createIcons();

        setTimeout(() => {
            step2.className = 'active';
            step2.innerHTML = '<i data-lucide="check-circle-2"></i> Mapping text to behavioral models';
            step3.className = '';
            step3.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Running Authenticity & Integrity checks';
            lucide.createIcons();
        }, 1200);

        setTimeout(() => {
            step3.className = 'active';
            step3.innerHTML = '<i data-lucide="check-circle-2"></i> Finalizing integrity verdict';
            lucide.createIcons();
        }, 2200);
    }

    function populateResults(res, role) {
        document.getElementById('res-role').innerText = role + " Output Report";
        document.getElementById('res-role-text').innerText = role;

        const s = res.finalScore.score;
        document.getElementById('res-score').innerText = s;
        const chart = document.querySelector('.circular-chart');
        chart.classList.remove('green', 'orange', 'red');
        if(s >= 80) chart.classList.add('green');
        else if(s >= 60) chart.classList.add('orange');
        else chart.classList.add('red');

        document.getElementById('res-recommendation').innerText = res.finalScore.recommendation;
        document.getElementById('res-recommendation').className = 
            s >= 80 ? 'decision-hire' : (s >= 60 ? 'decision-review' : 'decision-reject');

        document.getElementById('res-summary').innerText = res.candidateSummary;
        
        document.getElementById('res-degree').innerText = res.background ? res.background.collegeDegree : "N/A";
        document.getElementById('res-experience').innerText = res.background ? res.background.workExperienceYears : "N/A";
        document.getElementById('res-companies').innerText = res.background ? res.background.previousCompanies.join(', ') : "N/A";
        document.getElementById('res-hire-sheet').innerText = res.hireResponseSheet || "No response provided.";

        const skillsContainer = document.getElementById('res-skills');
        skillsContainer.innerHTML = '';
        res.skillMatch.forEach(sk => {
            const colorClass = sk.match >= 80 ? 'bg-success' : (sk.match >= 50 ? 'bg-warning' : 'bg-danger');
            skillsContainer.innerHTML += `
                <div class="skill-row">
                    <div class="skill-info">
                        <span>${sk.name}</span>
                        <span>${sk.match}%</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill ${colorClass}" style="width: ${sk.match}%"></div>
                    </div>
                    <div class="skill-just">${sk.justification}</div>
                </div>
            `;
        });

        const auth = res.authenticity;
        document.getElementById('auth-nature').innerText = auth.nature;
        document.getElementById('auth-consistency').innerText = auth.consistency;
        document.getElementById('auth-depth').innerText = auth.depth;
        document.getElementById('auth-risk-score').innerText = auth.riskScore;
        
        const riskFill = document.getElementById('auth-risk-fill');
        riskFill.style.width = auth.riskScore + '%';
        riskFill.className = 'impact-fill ' + (auth.riskScore < 30 ? 'bg-success' : (auth.riskScore < 70 ? 'bg-warning' : 'bg-danger'));
        
        document.getElementById('auth-signals').innerText = auth.signals;
        document.getElementById('auth-behavior').innerText = auth.behavioralMatch;

        const authBadge = document.getElementById('auth-verdict-badge');
        authBadge.innerText = auth.verdict;
        authBadge.className = 'badge ' + (auth.verdict === 'Authentic' ? 'authentic' : (auth.verdict === 'High Risk' ? 'high-risk' : 'verification'));

        const commContainer = document.getElementById('res-comm');
        commContainer.innerHTML = `
            <div class="comm-row"><span>Clarity</span> <strong>${res.communications.clarity}</strong></div>
            <div class="comm-row"><span>Confidence</span> <strong>${res.communications.confidence}</strong></div>
            <div class="comm-row border-none"><span>Persuasiveness</span> <strong>${res.communications.persuasion}</strong></div>
        `;

        const behavContainer = document.getElementById('res-behavioral');
        behavContainer.innerHTML = `
            <li><strong>Problem-solving:</strong> ${res.behavioral.problemSolving}</li>
            <li><strong>Adaptability:</strong> ${res.behavioral.adaptability}</li>
            <li><strong>Team Fit:</strong> ${res.behavioral.teamFit}</li>
        `;

        document.getElementById('res-strengths').innerHTML = res.strengths.map(s => `<li>${s}</li>`).join('');
        document.getElementById('res-redflags').innerHTML = res.redFlags.map(r => `<li>${r}</li>`).join('');
        document.getElementById('res-questions').innerHTML = res.followUp.map(q => `<div class="question-item">${q}</div>`).join('');
    }
});
