import EventEmitter from "events";
import { Socket } from "net";

// @ts-expect-error
import bufferpack from "bufferpack";
import * as utils from "./utils.js";
import type { ResolveObject } from "./classes/ResolveObject.js";
import type { Settings } from "./classes/Settings.js";
import type { ModeInput } from "./classes/ModeInput.js";
import type { Mode } from "./classes/Mode.js";
import type { RGBColor } from "./classes/RGBColor.js";
import Device from "./device.js";

const HEADER_SIZE = 16;
const CLIENT_PROTOCOL_VERSION = 5;

export default class Client extends EventEmitter {

    name!: string | "nodejs";
    port!: number | 6742;
    host!: string | "localhost";
	isConnected!: boolean | false
	protocolVersion!: number | undefined
	settings!: Settings

	protected resolver: ResolveObject[] = [];
	protected currentPacketLength: number
	private socket?: Socket

    constructor(name: string, port: number, host: string, settings: Settings = {forceProtocolVersion: 0}){
        
        super();

        this.name = name  || "nodejs"
		this.port = +port || 6742
		this.host = host  || "127.0.0.1"
		this.isConnected = false
		this.resolver = []
		this.currentPacketLength = 0
		this.settings = settings

    }

    /*
     * Connect to the Open RGB SDK 
     */
    async connect (timeout: number = 1000){

        this.socket = new Socket();

        let connectionPromise = Promise.race([
			new Promise((resolve) => this.socket!.once("connect", resolve)),
			new Promise((resolve) => this.socket!.once("error", resolve)),
			new Promise((resolve) => setTimeout(() => resolve("timeout"), timeout))
		]) as Promise<string|void|Error>;

        this.socket!.connect(this.port, this.host);

        let res = await connectionPromise;
        
		if (typeof res == "object") throw res;

        //If the connection is closed
        this.socket!.on("close", () => {
            this.emit("disconnect");
            this.isConnected = false;
        });

        //If an error is recieved
        this.socket!.on("error", (err: Error) => {
            this.emit("error", err);
            this.isConnected = false;
        });
        
        //We've recieved data so we've connected
        this.isConnected = true;

        //If we recieve several packets
        this.socket!.on("readable", () => {

            //Loop through the packets until nothing is left
            while(true){

                //If we were unable to read the packet the first time take packet length to next readable packet and try to read as a whole
                if(this.currentPacketLength == 0){

                    let header = this.socket!.read(HEADER_SIZE);
                    if(!header) return;

                    //Check for the 'ORGB' magic packet
                    if(!header.slice(0,4).equals(Buffer.from([0x4f, 0x52, 0x47, 0x42]))) return;

                    //Get the packet length
					this.currentPacketLength = header.readUInt32LE(12);
                    
					if (this.currentPacketLength > 0) {
						if (this.resolver[0]) {
							this.resolver[0].header = header;
						}
					} else {

						//For packets where there is only a header
						if (this.resolver.length) {
							resolve.bind(this)(header);
						}

					}
                }

                //If the current res is null, the packet has likely been split into two or more chunks. Wait for the next readable event so we can collect the rest.
                if (this.currentPacketLength > 0) {
					let res = this.socket!.read(this.currentPacketLength);
					if (!res) return;

					this.currentPacketLength = 0;

					if (this.resolver[0]) {
						resolve.bind(this)(Buffer.concat([this.resolver[0].header, res]));
					}
				}

            }
        });

        //Get the server protocol version
        let serverProtocolVersion = await (new Promise(async (resolve, reject) => {
			setTimeout(() => reject(0), timeout);
			resolve(await this.getProtocolVersion());
		}).catch(_ => _) as Promise<number>)

		if (this.settings.forceProtocolVersion && serverProtocolVersion == 0) {
			this.protocolVersion = this.settings.forceProtocolVersion;
		} else {
			let clientVersion = ("forceProtocolVersion" in this.settings) ? this.settings.forceProtocolVersion : CLIENT_PROTOCOL_VERSION;
			this.protocolVersion = (serverProtocolVersion < clientVersion!) ? serverProtocolVersion : clientVersion;
		}

		this.setClientName(this.name);
		this.emit("connect");


    }
    
    
	/**
	 * Disconnect from the Open RGB SDK 
	 */
	disconnect () {        
		this.socket!.end();
        this.isConnected = false;
		this.resolver = [];
	}
    
    /**
     * Get the current count of controllers/devices
     * @returns {Promise<number>}
     */
    async getControllerCount (): Promise<number> {
        this.sendMessage(utils.command.requestControllerCount);
        const buffer = await this.readMessage(utils.command.requestControllerCount);
        return buffer.readUInt32LE();
    }
    
    /**
     * Get the properties of all devices
     * @returns {Promise<Device[]>}
     */
    async getAllControllerData (): Promise<Device[]> {
        let devices = []
        let controllerCount = await this.getControllerCount();
        for (let i = 0; i < controllerCount; i++) {
            devices.push(await this.getControllerData(i));
        }
        return devices;
    }
        
    /**
     * Get the properties of a controller/device
     * @param {number} deviceId - the id of the requested device
     * @returns {Promise<Device>}
     */
    async getControllerData (deviceId: number): Promise<Device> { 
        this.sendMessage(utils.command.requestControllerData, bufferpack.pack("<I", [this.protocolVersion]), deviceId);
        const buffer = await this.readMessage(utils.command.requestControllerData, deviceId);
        return new Device(buffer, deviceId, this.protocolVersion!);
    }
    
    /**
     * Get the current protocol version from OpenRGB
     * @returns {Promise<number>}
     */
    async getProtocolVersion (): Promise<number> {
        let clientVersion = ("forceProtocolVersion" in this.settings) ? this.settings.forceProtocolVersion : CLIENT_PROTOCOL_VERSION;
        this.sendMessage(utils.command.requestProtocolVersion, bufferpack.pack("<I", [clientVersion]));
        const buffer = await this.readMessage(utils.command.requestProtocolVersion);
        return buffer.readUInt32LE();
    }
    
    /**
     * Get a list of all profiles in OpenRGB
     * @returns {Promise<String[]>}
     */
    async getProfileList (): Promise<string[]> {
        this.sendMessage(utils.command.requestProfileList);
        const buffer = (await this.readMessage(utils.command.requestProfileList)).slice(4);
        let count = buffer.readUInt16LE();
        let offset = 2;
        let profiles = [];
        for (let i = 0; i < count; i++) {
            let length = buffer.readUInt16LE(offset);
            offset += 2;
            profiles.push(bufferpack.unpack(`<${length-1}c`, buffer, offset).join(""));
            offset += length;
        }
        return profiles;
    }
    
    /**
     * Sets the name of the client
     * @param {string} name - the name displayed in OpenRGB
     */
    setClientName (name: string) {
        let nameBytes = Buffer.concat([new TextEncoder().encode(name), Buffer.from([0x00])]);
        this.sendMessage(utils.command.setClientName, nameBytes);
    }

    /**
     * Update all leds of a given device
     * @param {number} deviceId - the id of the device (these are usually incremental)
     * @param {RGBColor[]} colors - the colors the device should be set to
     */
    updateLeds (deviceId: number, colors: RGBColor[]) {
        const size = 2 + (4 * colors.length);

        const colorsBuffer = Buffer.alloc(size);
        colorsBuffer.writeUInt16LE(colors.length);

        for (let i = 0; i < colors.length; i++) {
            const color = colors[i];
            const offset = 2 + (i * 4);
            colorsBuffer.writeUInt8(color!.red, offset);
            colorsBuffer.writeUInt8(color!.green, offset + 1);
            colorsBuffer.writeUInt8(color!.blue, offset + 2);
        }

        const prefixBuffer = Buffer.alloc(4);
        prefixBuffer.writeUInt32LE(size);

        this.sendMessage(utils.command.updateLeds, Buffer.concat([prefixBuffer, colorsBuffer]), deviceId);
    }

    /**
     * Update all the LEDs of a given zone on a device
     * @param {number} deviceId - the id of the device (these are usually incremental)
     * @param {number} zoneId - the id of the zone
     * @param {RGBColor[]} colors - the colors the zone should be set to
     */
    updateZoneLeds (deviceId: number, zoneId: number, colors: RGBColor[]) {
        const size = 6 + (4 * colors.length);
        const colorsBuffer = Buffer.alloc(size);
        colorsBuffer.writeUInt32LE(zoneId);
        colorsBuffer.writeUInt16LE(colors.length, 4);
        for (let i = 0; i < colors.length; i++) {
            const color = colors[i];
            const offset = 6 + (i * 4);
            colorsBuffer.writeUInt8(color!.red, offset);
            colorsBuffer.writeUInt8(color!.green, offset + 1);
            colorsBuffer.writeUInt8(color!.blue, offset + 2);
        }
        const prefixBuffer = Buffer.alloc(4);
        prefixBuffer.writeUInt32LE(size);
        this.sendMessage(utils.command.updateZoneLeds, Buffer.concat([prefixBuffer, colorsBuffer]), deviceId);
    }
    
    /**
     * Update one led of a given device and led ID
     * @param {number} deviceId - the id of the device
     * @param {number} ledId - the id of the led
     * @param {RGBColor} color - the color the led should be set to
     */
    updateSingleLed (deviceId: number, ledId: number, color: RGBColor) {
        let buff = Buffer.concat([bufferpack.pack("<I", [ledId]), bufferpack.pack("<BBB", [color.red, color.green, color.blue]), Buffer.alloc(1)]);
        this.sendMessage(utils.command.updateSingleLed, buff, deviceId);
    }
    
    /**
     * Sets the device to its mode for individual led control
     * @param {number} deviceId - the id of the requested device
     */
    setCustomMode (deviceId: number) {
        this.sendMessage(utils.command.setCustomMode, undefined, deviceId);
    }
    
	/**
	 * Update the mode of a device
	 * @param {number} deviceId - the id of the device
	 * @param {ModeInput} mode - All fields are optional and missing ones will be filled in with the currently active settings. Either id or name must be given as an indication for which mode should be set. Purely informational fields like brightnessMax will be ignored but are allowed
	 */
	async updateMode (deviceId: number, mode: ModeInput | number | string) {
		await sendMode.bind(this)(deviceId, mode, false)
	}
    
    /**
     * Resize a zone  on a device
     * @param {number} deviceId - the id of the device
     * @param {number} zoneId - the id of the zone
     * @param {number} zoneLength - the length the zone should be set to
     */
    resizeZone (deviceId: number, zoneId: number, zoneLength: number) {
        this.sendMessage(utils.command.resizeZone, bufferpack.pack("<ii", [zoneId, zoneLength]), deviceId);
    }
    
    /**
     * Create a new profile with the current state of the devices in OpenRGB
     * @param {string} name - the name of the new profile
     */
    saveProfile (name: string) {
        let nameBytes = Buffer.concat([new TextEncoder().encode(name), Buffer.from([0x00])]);
        this.sendMessage(utils.command.saveProfile, nameBytes);
    }
    
    /**
     * Load a profile out of the storage
     * @param {string} name - the name of the profile that should be loaded
     */
    loadProfile (name: string) {
        let nameBytes = Buffer.concat([new TextEncoder().encode(name), Buffer.from([0x00])]);
        this.sendMessage(utils.command.loadProfile, nameBytes);
    }
    
    /**
     * Delete a profile out of the storage
     * @param {string} name - the name of the profile that should be deleted
     */
    deleteProfile (name: string) {
        let nameBytes = Buffer.concat([new TextEncoder().encode(name), Buffer.from([0x00])]);
        this.sendMessage(utils.command.deleteProfile, nameBytes);
    }
    
	/**
	 * @private
	 */
	sendMessage (commandId: number, buffer: Buffer = Buffer.alloc(0), deviceId: number = 0) {
		if (!this.isConnected) throw new Error("can't write to socket if not connected to OpenRGB");
		const header = this.encodeHeader(commandId, buffer.byteLength, deviceId);
		const packet = Buffer.concat([header,buffer]);
		this.socket!.write(packet);
	}
    
	/**
	 * @private
	 */
	async readMessage (commandId: number, deviceId: number = 0): Promise<Buffer> {
		if (!this.isConnected) throw new Error("can't read from socket if not connected to OpenRGB");
		return new Promise(resolve => this.resolver.push({resolve, commandId, deviceId}));
	}
    
	/**
	 * @private
	 */
	encodeHeader (commandId: number, length: number, deviceId: number) {
		const buffer = Buffer.alloc(HEADER_SIZE);

		let index = buffer.write("ORGB", "ascii");
		index = buffer.writeUInt32LE(deviceId, index);
		index = buffer.writeUInt32LE(commandId, index);
		index = buffer.writeUInt32LE(length, index);

		return buffer;
	}
        
    /**
	 * @private
	 */
	decodeHeader (buffer: Buffer) {
		const deviceId = buffer.readUInt32LE(4);
		const commandId = buffer.readUInt32LE(8);
		const length = buffer.readUInt32LE(12);
		return { deviceId, commandId, length };
	}
    
    /**
     * @private
     */
    pack_color_list (arr: RGBColor[]) {
        let out = bufferpack.pack("<H", [arr.length])
        arr.forEach(element => {
            out = Buffer.concat([out, Buffer.from(""), bufferpack.pack("<BBBx", [element.red, element.green, element.blue])])
        })
        return out
    }
    /**
     * @private
     */
    pack_string (string: string) {
        return Buffer.concat([bufferpack.pack(`<H${string.length}s`, [string.length + 1, string]), Buffer.from('\x00')])
    }

}

async function sendMode (this: Client, deviceId: number, mode: ModeInput | number | string, save: boolean) {
    
    if (typeof deviceId != "number") throw new Error("arg deviceId not given");

    let device: Device = await this.getControllerData(deviceId);
    let modeId: number | undefined, modeName: string | undefined;
    let modeData: Mode;

    switch (typeof mode) {
        case "number":
            modeId = mode
            break
        case "string":
            modeName = mode
            break
        case "object":
            if ("id" in mode) modeId = mode.id
            else if ("name" in mode) modeName = mode.name
            else throw new Error("Either mode.id or mode.name have to be given, but both are missing")
            break
        default:
            throw new Error(`Mode must be of type number, string or object, but is of type ${typeof mode} `)
    }

    if (modeId !== undefined) {
        if (!device.modes[modeId]) throw new Error("ID given is not the ID of a mode");
        modeData = device.modes[modeId]!;
    } else if (modeName !== undefined) {
        const nameSearch = device.modes.find((elem: Mode) => elem.name.toLowerCase() == modeName!.toLowerCase());
        if (nameSearch === undefined) throw new Error("Name given is not the name of a mode");
        modeData = nameSearch;
    } else {
        // this can never be triggered, it just to shut ts up -- really?
        throw new Error(`Mode must be of type number, string or object, but is of type ${typeof mode} `);
    }

    if (typeof mode == "object") {
        if (mode.speed) modeData.speed = mode.speed;
        if (mode.brightness) modeData.brightness = mode.brightness;
        if (mode.direction) modeData.direction = mode.direction;
        if (mode.colorMode) modeData.colorMode = mode.colorMode;
        if (mode.colors) modeData.colors = mode.colors;
    }

    let pack;

    if (this.protocolVersion! >= 3) {
        pack = bufferpack.pack("<12I", [
            modeData.value, 
            modeData.flags, 
            modeData.speedMin, 
            modeData.speedMax, 
            modeData.brightnessMin, 
            modeData.brightnessMax, 
            modeData.colorMin, 
            modeData.colorMax, 
            modeData.speed,
            modeData.brightness,
            modeData.direction, 
            modeData.colorMode
        ]);
    } else {
        pack = bufferpack.pack("<9I", [
            modeData.value, 
            modeData.flags, 
            modeData.speedMin, 
            modeData.speedMax, 
            modeData.colorMin, 
            modeData.colorMax, 
            modeData.speed, 
            modeData.direction, 
            modeData.colorMode
        ]);
    }

    let data = Buffer.concat([
        bufferpack.pack("<I", [modeData.id]),
        this.pack_string(modeData.name),
        pack,
        this.pack_color_list(modeData.colors ? modeData.colors : []), 
    ]);

    data = Buffer.concat([bufferpack.pack("<I", [data.length, bufferpack.calcLength("<I")]), data]);
    this.sendMessage(save ? utils.command.saveMode : utils.command.updateMode, data, deviceId);

}

function resolve (this: Client, buffer: Buffer) {
    let { deviceId, commandId } = this.decodeHeader(buffer);
    switch (commandId) {
        case utils.command.deviceListUpdated: {
            this.emit("deviceListUpdated");
            break;
        }
        default: {
            if (this.resolver.length) {
                let index = this.resolver.findIndex( resolver => resolver.deviceId == deviceId && resolver.commandId == commandId);
                if (index < 0) return;

                this.resolver.splice(index, 1)[0]!.resolve(buffer.slice(16));
            }
        }
    }
}


