/**
 * ============================================================
 * VeriHire AI — Production WebRTC Manager
 * ============================================================
 * Handles the full RTCPeerConnection lifecycle:
 * - Dynamic ICE server fetching (STUN + TURN)
 * - Offer/Answer SDP exchange via Socket.io
 * - ICE candidate trickle
 * - Connection state monitoring with auto-reconnect
 * - Network quality metrics (bitrate, packet loss, jitter)
 * - Media track management (camera, mic, screen share)
 * ============================================================
 */

class WebRTCManager {
    constructor(socket, options = {}) {
        this.socket = socket;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.screenStream = null;
        this.iceServers = [];
        this.roomId = null;
        this.role = null; // 'interviewer' or 'candidate'
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.statsInterval = null;
        this.lastBytesReceived = 0;
        this.lastTimestamp = 0;

        // Callbacks
        this.onRemoteStream = options.onRemoteStream || (() => {});
        this.onConnectionStateChange = options.onConnectionStateChange || (() => {});
        this.onNetworkQuality = options.onNetworkQuality || (() => {});
        this.onDisconnected = options.onDisconnected || (() => {});
        this.onReconnecting = options.onReconnecting || (() => {});
        this.onError = options.onError || (() => {});

        this._setupSocketListeners();
    }

    /**
     * Fetch ICE server configuration from the backend.
     * TURN credentials are never exposed in client code.
     */
    async fetchIceServers() {
        try {
            const response = await fetch('/api/ice-servers');
            if (response.ok) {
                const data = await response.json();
                this.iceServers = data.iceServers;
                console.log('[WebRTC] ICE servers loaded from backend:', this.iceServers.length, 'servers');
                return;
            }
        } catch (err) {
            console.warn('[WebRTC] Could not fetch ICE servers from backend, using defaults.');
        }

        // Fallback: Public STUN only (no TURN — won't work behind strict NATs)
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ];
    }

    /**
     * Create a new RTCPeerConnection with the fetched ICE servers.
     */
    createPeerConnection() {
        if (this.peerConnection) {
            this.peerConnection.close();
        }

        const config = {
            iceServers: this.iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        };

        this.peerConnection = new RTCPeerConnection(config);
        console.log('[WebRTC] PeerConnection created with', this.iceServers.length, 'ICE servers');

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle remote tracks
        this.peerConnection.ontrack = (event) => {
            console.log('[WebRTC] Remote track received:', event.track.kind);
            this.remoteStream = event.streams[0];
            this.onRemoteStream(event.streams[0]);
        };

        // ICE candidate handling
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                this.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    roomId: this.roomId
                });
            }
        };

        // ICE gathering state
        this.peerConnection.onicegatheringstatechange = () => {
            console.log('[WebRTC] ICE gathering state:', this.peerConnection.iceGatheringState);
        };

        // ICE connection state (for connectivity)
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('[WebRTC] ICE connection state:', state);

            switch (state) {
                case 'connected':
                case 'completed':
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.onConnectionStateChange('connected');
                    this._startStatsMonitoring();
                    break;
                case 'disconnected':
                    this.onConnectionStateChange('disconnected');
                    this._attemptReconnect();
                    break;
                case 'failed':
                    this.onConnectionStateChange('failed');
                    this._attemptReconnect();
                    break;
                case 'closed':
                    this.isConnected = false;
                    this._stopStatsMonitoring();
                    this.onConnectionStateChange('closed');
                    break;
            }
        };

        // Overall connection state
        this.peerConnection.onconnectionstatechange = () => {
            console.log('[WebRTC] Connection state:', this.peerConnection.connectionState);
        };
    }

    /**
     * Get local media stream (camera + mic)
     */
    async getLocalStream(videoConstraints = true, audioConstraints = true) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
                audio: audioConstraints
            });
            console.log('[WebRTC] Local stream acquired:', this.localStream.getTracks().map(t => t.kind));
            return this.localStream;
        } catch (err) {
            console.error('[WebRTC] Failed to get local stream:', err);
            this.onError('camera', err);
            throw err;
        }
    }

    /**
     * Start screen sharing
     */
    async startScreenShare() {
        try {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });

            const screenTrack = this.screenStream.getVideoTracks()[0];

            // Replace video track in the peer connection
            if (this.peerConnection) {
                const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    await sender.replaceTrack(screenTrack);
                }
            }

            // When screen share ends, revert to camera
            screenTrack.onended = () => {
                this.stopScreenShare();
            };

            console.log('[WebRTC] Screen share started');
            return this.screenStream;
        } catch (err) {
            console.warn('[WebRTC] Screen share cancelled or failed:', err);
            return null;
        }
    }

    /**
     * Stop screen sharing and revert to camera
     */
    async stopScreenShare() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }

        // Revert to camera
        if (this.localStream && this.peerConnection) {
            const cameraTrack = this.localStream.getVideoTracks()[0];
            const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && cameraTrack) {
                await sender.replaceTrack(cameraTrack);
            }
        }
        console.log('[WebRTC] Screen share stopped, reverted to camera');
    }

    /**
     * Join a room and set up for signaling
     */
    async joinRoom(roomId, role) {
        this.roomId = roomId;
        this.role = role;

        await this.fetchIceServers();
        this.createPeerConnection();

        this.socket.emit('join-room', roomId, role);
        console.log(`[WebRTC] Joined room ${roomId} as ${role}`);
    }

    /**
     * Create and send an SDP offer (interviewer initiates)
     */
    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await this.peerConnection.setLocalDescription(offer);
            this.socket.emit('offer', offer);
            console.log('[WebRTC] Offer sent');
        } catch (err) {
            console.error('[WebRTC] Failed to create offer:', err);
            this.onError('offer', err);
        }
    }

    /**
     * Handle an incoming offer and send answer (candidate responds)
     */
    async handleOffer(offer) {
        try {
            if (!this.peerConnection) {
                this.createPeerConnection();
            }
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.socket.emit('answer', answer);
            console.log('[WebRTC] Answer sent');
        } catch (err) {
            console.error('[WebRTC] Failed to handle offer:', err);
            this.onError('answer', err);
        }
    }

    /**
     * Handle an incoming answer
     */
    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('[WebRTC] Answer received and set');
        } catch (err) {
            console.error('[WebRTC] Failed to handle answer:', err);
        }
    }

    /**
     * Handle an incoming ICE candidate
     */
    async handleIceCandidate(candidate) {
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (err) {
            console.warn('[WebRTC] Failed to add ICE candidate:', err);
        }
    }

    /**
     * Attempt to reconnect via ICE restart
     */
    async _attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebRTC] Max reconnect attempts reached');
            this.onError('reconnect', new Error('Max reconnect attempts exceeded'));
            return;
        }

        this.reconnectAttempts++;
        this.onReconnecting(this.reconnectAttempts);
        console.log(`[WebRTC] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

        try {
            // ICE restart
            const offer = await this.peerConnection.createOffer({ iceRestart: true });
            await this.peerConnection.setLocalDescription(offer);
            this.socket.emit('offer', offer);
        } catch (err) {
            console.error('[WebRTC] Reconnect failed:', err);
            // Retry after delay
            setTimeout(() => this._attemptReconnect(), 2000 * this.reconnectAttempts);
        }
    }

    /**
     * Monitor network quality using WebRTC stats API
     */
    _startStatsMonitoring() {
        this._stopStatsMonitoring();

        this.statsInterval = setInterval(async () => {
            if (!this.peerConnection) return;

            try {
                const stats = await this.peerConnection.getStats();
                let quality = { level: 'excellent', bitrate: 0, packetLoss: 0, jitter: 0, roundTrip: 0 };

                stats.forEach(report => {
                    // Inbound RTP (receiving)
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        const now = report.timestamp;
                        const bytes = report.bytesReceived;

                        if (this.lastTimestamp > 0) {
                            const timeDiff = (now - this.lastTimestamp) / 1000;
                            quality.bitrate = Math.round(((bytes - this.lastBytesReceived) * 8) / timeDiff / 1000); // kbps
                        }

                        this.lastBytesReceived = bytes;
                        this.lastTimestamp = now;

                        if (report.packetsLost !== undefined && report.packetsReceived > 0) {
                            quality.packetLoss = Math.round((report.packetsLost / (report.packetsLost + report.packetsReceived)) * 100);
                        }
                        if (report.jitter !== undefined) {
                            quality.jitter = Math.round(report.jitter * 1000); // ms
                        }
                    }

                    // Candidate pair (round trip)
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        quality.roundTrip = Math.round(report.currentRoundTripTime * 1000); // ms
                    }
                });

                // Determine quality level
                if (quality.packetLoss > 10 || quality.roundTrip > 300 || quality.bitrate < 100) {
                    quality.level = 'poor';
                } else if (quality.packetLoss > 3 || quality.roundTrip > 150 || quality.bitrate < 500) {
                    quality.level = 'good';
                } else {
                    quality.level = 'excellent';
                }

                this.onNetworkQuality(quality);
            } catch (err) {
                // Stats not available yet
            }
        }, 3000);
    }

    _stopStatsMonitoring() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    /**
     * Set up Socket.io listeners for signaling
     */
    _setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('user-connected', async (role) => {
            console.log('[WebRTC] Remote user connected:', role);
            if (this.role === 'interviewer') {
                await this.createOffer();
            }
        });

        this.socket.on('offer', async (offer) => {
            await this.handleOffer(offer);
        });

        this.socket.on('answer', async (answer) => {
            await this.handleAnswer(answer);
        });

        this.socket.on('ice-candidate', async (data) => {
            const candidate = data.candidate || data;
            await this.handleIceCandidate(candidate);
        });

        this.socket.on('user-disconnected', (role) => {
            console.log('[WebRTC] Remote user disconnected:', role);
            this.onDisconnected(role);
        });
    }

    /**
     * Full cleanup
     */
    destroy() {
        this._stopStatsMonitoring();

        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.isConnected = false;
        console.log('[WebRTC] Manager destroyed');
    }
}

// Export for browser
window.WebRTCManager = WebRTCManager;
