// omxplayer-dbus.js
//
// Based on the work of sy1vain on GitHub
// https://github.com/sy1vain/omxplayer/blob/master/lib/OmxPlayer.js
// modified, optimized and extended with additional functions from
// https://github.com/popcornmix/omxplayer#dbus-control and
// https://raw.githubusercontent.com/popcornmix/omxplayer/master/dbuscontrol.sh

"use strict";

const {spawn, exec} = require('child_process');
const EventEmitter = require('events');
const os = require('os');
const fs = require('fs');
const dbus = require('dbus-native');
const ps = require('ps-node');

const USER = os.userInfo().username;
const DBUS_ADDR = `/tmp/omxplayerdbus.${USER}`;
const DBUS_NAME = 'org.mpris.MediaPlayer2.omxplayer';
const DBUS_PATH = '/org/mpris/MediaPlayer2';
const DBUS_INTERFACE_PROPERTIES = 'org.freedesktop.DBus.Properties';
const DBUS_INTERFACE_PLAYER = 'org.mpris.MediaPlayer2.Player';
const DBUS_INTERFACE_ROOT = 'org.mpris.MediaPlayer2';

let INSTANCE_COUNT = 0;

class OmxPlayer extends EventEmitter {

    constructor() {
        super();
        this.process = null;
        this.instance = INSTANCE_COUNT++;
    }

    kill(cb) {
        return this._stopProcess(cb);
    }

    open(file, options, cb) {
        options = (typeof options !== 'undefined') ? options : {};

        this.file = file;
        this.options = options;

        return this._startProcess(this.options, cb);
    }


    isRunning(cb) {
        if (cb) cb(!!this.process);
        return Promise.resolve(!!this.process);
    }

    getChildPid(cb) {
        return this.isRunning().then((running) => {
            if (!running) throw 'Not running';
            if (this.child_process) {
                if (cb) cb(this.child_process);
                return this.child_process;
            }

            return new Promise((resolve, reject) => {
                ps.lookup({
                    command: 'omxplayer.bin',
                    psargs: '-le',
                    ppid: this.process.pid
                }, (err, results) => {
                    if (results.length !== 1) return reject('no matching process found');
                    let result = results.shift();
                    this.child_process = result.pid;
                    if (cb) cb(result.pid);
                    resolve(result.pid);
                });
            });
        });
    }

    // ##########################################
    // Root Interface / Methods
    // ##########################################

    // Stops the currently playing video. This will cause the currently running omxplayer process to terminate.
    // (returns null)
    quit(cb) {
        return this._invokeDBus('Quit', DBUS_INTERFACE_ROOT, null, null, cb);
    }

    // No effect? (returns null)
    raise(cb) {
        return this._invokeDBus('Raise', DBUS_INTERFACE_ROOT, null, null, cb);
    }

    // ##########################################
    // Root Interface / Properties
    // ##########################################

    // Whether or not the player can quit. (returns boolean)
    getCanQuit(cb) {
        return this._invokeDBus('CanQuit', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player is fullscreen. (returns boolean)
    getCanFullscreen(cb) {
        return this._invokeDBus('Fullscreen', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player can be set fullscreen. (returns boolean)
    getCanSetFullscreen(cb) {
        return this._invokeDBus('CanSetFullscreen', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether the display window can be brought to the top of all the window. (returns boolean)
    getCanRaise(cb) {
        return this._invokeDBus('CanRaise', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player has a track list. (returns boolean)
    getHasTrackList(cb) {
        return this._invokeDBus('HasTrackList', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Name of the player. (returns string)
    getIdentity(cb) {
        return this._invokeDBus('Identity', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Playable URI formats. (returns string[])
    getSupportedUriSchemes(cb) {
        return this._invokeDBus('SupportedUriSchemes', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Supported mime types. Note: currently not implemented in omxplayer. (returns string[])
    getSupportedMimeTypes(cb) {
        return this._invokeDBus('SupportedMimeTypes', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // ##########################################
    // Player Interface / Methods
    // ##########################################

    // Skip to the next chapter. (returns null)
    next(cb) {
        return this._invokeDBus('Next', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Skip to the previous chapter. (returns null)
    previous(cb) {
        return this._invokeDBus('Previous', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Play the video. If the video is playing, it has no effect, if it is paused it will play from current position.
    // (returns null)
    play(cb) {
        // this is described in the api, but does not seem to work
        // this._invokeDBus('Play', DBUS_INTERFACE_PLAYER, null, null, cb);
        return this.getPlaying((err, playing) => {
            if (err) return cb && cb(err);
            if (playing) return cb && cb();
        }).then((playing) => {
            if (playing) return Promise.resolve();
            return this.playPause(cb);
        });
    }

    // Pause the video. If the video is playing, it will be paused, if it is paused it will stay in pause (no effect).
    // (returns null)
    pause(cb) {
        return this._invokeDBus('Pause', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Toggles the play state. If the video is playing, it will be paused, if it is paused it will start playing.
    // (returns null)
    playPause(cb) {
        return this._invokeDBus('PlayPause', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Stops the video. This has the same effect as Quit (terminates the omxplayer instance).
    // (returns null)
    stop(cb) {
        return this._invokeDBus('Stop', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Perform a relative seek, i.e. seek plus or minus a certain number of seconds from the current position in the video.
    // If the supplied offset is invalid, null is returned, otherwise the offset (in seconds) is returned
    seek(seconds, cb) {
        return this._invokeDBus('Seek', DBUS_INTERFACE_PLAYER, 'x', [seconds * 1e6], (err, offset) => {
            if (err || offset == null) return cb && cb(err, null);
            return cb && cb(null, offset / 1e6);
        }).then((offset) => {
            if (offset == null) return Promise.reject();
            return offset / 1e6;
        });
    }

    // Seeks to a specific location in the file. This is an absolute seek.
    // If the supplied position is invalid, null is returned, otherwise the position (in seconds) is returned
    setPosition(seconds, cb) {
        return this._invokeDBus('SetPosition', DBUS_INTERFACE_PLAYER, 'ox', ['/not/used', seconds * 1e6], (err, position) => {
            if (err || position == null) return cb && cb(err, null);
            return cb && cb(null, position / 1e6);
        }).then((position) => {
            if (position == null) return Promise.reject();
            return position / 1e6;
        });
    }

    // Set the alpha transparency of the player [0-255].
    // (returns nothing)
    setAlpha(alpha, cb) {
        return this._invokeDBus('SetAlpha', DBUS_INTERFACE_PLAYER, 'ox', ['/not/used', alpha], cb);
    }

    // Seeks the video playback layer.
    // (returns nothing)
    setLayer(layer, cb) {
        return this._invokeDBus('SetLayer', DBUS_INTERFACE_PLAYER, 'ox', ['/not/used', layer], cb);
    }

    // Mute the audio stream. If the volume is already muted, this does nothing.
    // (returns nothing)
    mute(cb) {
        return this._invokeDBus('Mute', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Unmute the audio stream. If the stream is already unmuted, this does nothing.
    // (returns nothing)
    unmute(cb) {
        return this._invokeDBus('Unmute', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Returns a array of all known subtitles. The length of the array is the number of subtitles.
    // see https://github.com/popcornmix/omxplayer#listsubtitles
    // (returns string[])
    listSubtitles(cb) {
        return this._invokeDBus('ListSubtitles', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Returns and array of all known audio streams. The length of the array is the number of streams.
    // see https://github.com/popcornmix/omxplayer#listaudio
    // (returns string[])
    listAudio(cb) {
        return this._invokeDBus('ListAudio', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Returns and array of all known video streams. The length of the array is the number of streams.
    // see https://github.com/popcornmix/omxplayer#listvideo
    // (returns string[])
    listVideo(cb) {
        return this._invokeDBus('ListVideo', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Selects the subtitle at a given index. Returns true if subtitle was selected, false otherwise.
    selectSubtitle(index, cb) {
        return this._invokeDBus('SelectSubtitle', DBUS_INTERFACE_PLAYER, 'x', [index], cb);
    }

    // Selects the audio stream at a given index. Returns true if subtitle was selected, false otherwise.
    selectAudio(index, cb) {
        return this._invokeDBus('SelectAudio', DBUS_INTERFACE_PLAYER, 'x', [index], cb);
    }

    // Turns on subtitles.
    // (returns null)
    showSubtitles(cb) {
        return this._invokeDBus('ShowSubtitles', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Turns off subtitles.
    // (returns null)
    hideSubtitles(cb) {
        return this._invokeDBus('HideSubtitles', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // The current file or stream that is being played.
    // (returns string)
    getSource(cb) {
        return this._invokeDBus('GetSource', DBUS_INTERFACE_PLAYER, null, null, cb);
    }

    // Execute a "keyboard" command. For available codes, see KeyConfig.h.
    // https://github.com/popcornmix/omxplayer/blob/master/KeyConfig.h
    // (returns null)
    action(command, cb) {
        return this._invokeDBus('Action', DBUS_INTERFACE_PLAYER, 'i', [command], cb);
    }

    // ##########################################
    // Player Interface / Properties
    // ##########################################

    // Whether or not the play can skip to the next track.
    // (returns boolean)
    getCanGoNext(cb) {
        return this._invokeDBus('CanGoNext', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player can skip to the previous track.
    // (returns boolean)
    getCanGoPrevious(cb) {
        return this._invokeDBus('CanGoPrevious', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player can seek.
    // (returns boolean)
    getCanSeek(cb) {
        return this._invokeDBus('CanSeek', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player can be controlled.
    // (returns boolean)
    getCanControl(cb) {
        return this._invokeDBus('CanControl', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player can play.
    // (returns boolean)
    getCanPlay(cb) {
        return this._invokeDBus('CanPlay', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Whether or not the player can pause.
    // (returns boolean)
    getCanPause(cb) {
        return this._invokeDBus('CanPause', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // The current state of the player, either "Paused" or "Playing".
    // (returns string)
    getPlaybackStatus(cb) {
        return this._invokeDBus('PlaybackStatus', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // When called with an argument it will set the volume and return the current volume. (returns double)
    // When called without an argument it will simply return the current volume.
    //      volume = pow(10, mB / 2000.0);
    //      mB     = 2000.0 * log10(volume)
    getVolume(cb) {
        return this._invokeDBus('Volume', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    setVolume(volume, cb) {
        return this._invokeDBus('Volume', DBUS_INTERFACE_PROPERTIES, 'd', [volume], cb);
    }

    // Restart and open another URI for playing.
    // (returns nothing)
    openUri(uri, cb) {
        return this._invokeDBus('OpenUri', DBUS_INTERFACE_PROPERTIES, 's', [uri], cb);
    }

    // Returns the current position of the playing media.
    // (returns int, position in seconds)
    getPosition(cb) {
        return this._invokeDBus('Position', DBUS_INTERFACE_PROPERTIES, null, null, (err, ...result) => {
            if (err) return cb && cb(err, null);
            return cb && cb(null, result / 1e6);
        }).then((position) => {
            return position / 1e6;
        });
    }

    // Returns the minimum playback rate of the video.
    // (returns double)
    getMinimumRate(cb) {
        return this._invokeDBus('MinimumRate', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Returns the maximum playback rate of the video.
    // (returns double)
    getMaximumRate(cb) {
        return this._invokeDBus('MaximumRate', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // When called with an argument it will set the playing rate and return the current rate. (returns double)
    // When called without an argument it will simply return the current rate.
    getRate(cb) {
        return this._invokeDBus('Rate', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    setRate(rate, cb) {
        return this._invokeDBus('Rate', DBUS_INTERFACE_PROPERTIES, 'd', [rate], cb);
    }

    // Returns track information: URI and length.
    // (returns dict)
    getMetadata(cb) {
        return this._invokeDBus('Metadata', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Returns the aspect ratio.
    // (returns double)
    getAspect(cb) {
        return this._invokeDBus('Aspect', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Returns the number of video streams.
    // (returns int64)
    getVideoStreamCount(cb) {
        return this._invokeDBus('VideoStreamCount', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Returns video width
    // (returns int64)
    getResWidth(cb) {
        return this._invokeDBus('ResWidth', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Returns video height
    // (returns int64)
    getResHeight(cb) {
        return this._invokeDBus('ResHeight', DBUS_INTERFACE_PROPERTIES, null, null, cb);
    }

    // Returns the total length of the playing media.
    // (returns int64)
    getDuration(cb) {
        return this._invokeDBus('Duration', DBUS_INTERFACE_PROPERTIES, null, null, (err, ...result) => {
            if (err) return cb && cb(err, null);
            return cb && cb(null, result / 1e6);
        }).then((result) => {
            return result / 1e6;
        });
    }

    // ##########################################
    // Additional Functions
    // ##########################################

    // Get status 'Playing' as bool
    getPlaying(cb) {
        return this.getPlaybackStatus((err, status) => {
            return cb && cb(err, status === 'Playing');
        }).then((status) => {
            return status === 'Playing';
        });
    }

    // Get status 'Paused' as bool
    getPaused(cb) {
        return this.getPlaybackStatus((err, status) => {
            return cb && cb(err, status === 'Paused');
        }).then((status) => {
            return status === 'Paused';
        });
    }

    //     --win x1,y1,x2,y2       Set position of video window
    setVideoPos(x1, y1, x2, y2, cb) {
        let unpack = function (result) {
            result = result.split(' ');
            for (let i = 0, len = result.length; i < len; i++) {
                result[i] = parseInt(result[i]);
            }
            // result.forEach((r, i, l) => {
            //     l[i] = parseInt(r);
            // });
            return result;
        };

        return this._invokeDBus('VideoPos', DBUS_INTERFACE_PLAYER, 'os', ['/not/used', `${x1} ${y1} ${x2} ${y2}`], (err, ...result) => {
            if (err) return cb && cb(err, null);
            return cb && cb(null, unpack(result));
        }).then((result) => {
            return unpack(result);
        });
    }

    // Set video crop area
    //  --crop x1,y1,x2,y2
    setVideoCropPos(x1, y1, x2, y2, cb) {
        let unpack = function (result) {
            result = result.split(' ');
            for (let i = 0, len = result.length; i < len; i++) {
                result[i] = parseInt(result[i]);
            }
            // result.forEach((r, i, l) => {
            //     l[i] = parseInt(r);
            // });
            return result;
        };

        return this._invokeDBus('SetVideoCropPos', DBUS_INTERFACE_PLAYER, 'os', ['/not/used', `${x1} ${y1} ${x2} ${y2}`], (err, ...result) => {
            if (err) return cb && cb(err, null);
            return cb && cb(null, unpack(result));
        }).then((result) => {
            return unpack(result);
        });
    }

    // Set aspect mode
    //  --aspect-mode type
    //  Letterbox, fill, stretch. Default: stretch if win is specified, letterbox otherwise
    setAspectMode(mode, cb) {
        return this._invokeDBus('SetAspectMode', DBUS_INTERFACE_PLAYER, 'os', ['/not/used', mode], cb);
    }

    // Toggle subtitles
    toggleSubtitles(cb) {
        return this._invokeDBus('Action', DBUS_INTERFACE_PLAYER, 'i', [12], cb);
    }

    // Hide video
    hideVideo(cb) {
        return this._invokeDBus('Action', DBUS_INTERFACE_PLAYER, 'i', [28], cb);
    }

    // Unhide video
    unhideVideo(cb) {
        return this._invokeDBus('Action', DBUS_INTERFACE_PLAYER, 'i', [29], cb);
    }

    // Volume up
    volumeUp(cb) {
        return this._invokeDBus('Action', DBUS_INTERFACE_PLAYER, 'i', [18], cb);
    }

    // Volume down
    volumeDown(cb) {
        return this._invokeDBus('Action', DBUS_INTERFACE_PLAYER, 'i', [17], cb);
    }

    // ##########################################
    // Private Methods
    // ##########################################

    _startProcess(options, cb) {
        return this._stopProcess().then(() => {
            let args = [];
            for (let key of Object.keys(options)) {
                let value = options[key];
                if (value === false) continue;
                args.push(`${(key.length === 1) ? '-' : '--'}${key}`);
                if (value === true) continue;
                args.push(value);
            }

            args.push('--dbus_name');
            args.push(DBUS_NAME + this.instance);

            this.dbus = null;
            this.process = spawn('omxplayer', [...args, this.file], {stdio: 'pipe'});

            this.process.stdout.on('data', (data) => {
                this.emit('stdout', data);
            });

            this.process.stderr.on('data', (data) => {
                this.emit('stderr', data);
            });

            this.process.on('error', (err) => {
                this.emit('error', err);
            });

            this.process.on('close', (code) => {
                this.process = null;
                this.child_process = null;
                this.dbus = null;
                this.emit('close', code);
            });

            if (cb) cb();
            return Promise.resolve();
        });
    }

    _stopProcess(cb) {
        return this.isRunning().then((running) => {
            if (!running) throw 'Not running';
            return this.getChildPid();
        }).then((pid) => {
            return new Promise((resolve, reject) => {
                ps.kill(pid, resolve);
            });
        }).then(() => {
            if (this.process) {
                this.process.removeAllListeners();
            }
            this.process = null;
            this.child_process = null;
            this.dbus = null;

            if (cb) cb();
        }).catch(() => {
            return Promise.resolve();
        });
    }

    _getDBus() {
        if (this.dbus) return Promise.resolve(this.dbus);
        return new Promise((resolve, reject) => {
            fs.readFile(DBUS_ADDR, 'utf8', (err, data) => {
                if (err) return reject(err);
                if (!data.length) return reject('no data in dbus file');
                this.dbus = dbus.sessionBus({
                    busAddress: data.trim()
                });
                resolve(this.dbus);
            });
        });
    }

    _invokeDBus(member, iface, signature, body, cb) {
        return this.getChildPid().then(() => {
            return this._getDBus();
        }).then((dbus) => {
            if (!dbus) {
                if (cb) cb('dbus not initialized');
                return Promise.reject('dbus not initialized');
            }

            return new Promise((resolve, reject) => {
                dbus.invoke({
                    path: DBUS_PATH,
                    destination: DBUS_NAME + this.instance,
                    interface: iface,
                    member,
                    signature,
                    body
                }, (err, ...results) => {
                    if (cb) cb(err, ...results);
                    if (err) return reject(err);
                    resolve(...results);
                });
            });
        });
    }
}

module.exports = OmxPlayer;
