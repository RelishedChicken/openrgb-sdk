import { RGBColor } from "./classes/RGBColor.js";
import { Mode } from "./classes/Mode.js";
import { Segment } from "./classes/Segment.js";
import { Matrix } from "./classes/Matrix.js";
import { Zone } from "./classes/Zone.js";

export default class Device{

    deviceId: number;
    type: number;
    name: string;
    vendor?: string;
    description: string;
    version: string;
    serial: string;
    location: string;
    activeMode: number;
    modes: Mode[];
    zones: Zone[];
    leds: {
        name: string
        value: number
    }[];
    colors: RGBColor[];

    constructor(buffer: Buffer, deviceId: number, protocolVersion: number){

        //Set the Device's ID
        this.deviceId = deviceId;

        //Read the buffer
        let offset = 4;
        this.type=buffer.readInt32LE(offset);
		offset += 4;

        //Get the name & it's length
		let { text: nameText, length: nameLength } = readString(buffer, offset);
		offset += nameLength;

        //Protocols 1 and higher give vendor info
		if (protocolVersion >= 1) {
			let { text: vendorText, length: vendorLength } = readString(buffer, offset);
			offset += vendorLength;
			this.vendor = vendorText;
		}
        
        //Get the description, version, serial and location (and lengths)
		let { text: descriptionText, length: descriptionLength } = readString(buffer, offset);
		offset += descriptionLength;
		let { text: versionText, length: versionLength } = readString(buffer, offset);
		offset += versionLength;
		let { text: serialText, length: serialLength } = readString(buffer, offset);
		offset += serialLength;
		let { text: locationText, length: locationLength } = readString(buffer, offset);
		offset += locationLength;

        //Set all these to this object
		this.name = nameText;
		this.description = descriptionText;
		this.version = versionText;
		this.serial = serialText;
		this.location = locationText;  

        //Get the number of available modes, the active mode and all available modes
		const modeCount = buffer.readUInt16LE(offset)
		offset += 2
		this.activeMode = buffer.readInt32LE(offset)
		offset += 4
		const { modes, offset: readModesOffset } = readModes(buffer, modeCount, offset, protocolVersion);
		this.modes = modes;
		offset = readModesOffset;

        //Same again but for zones
		const zoneCount = buffer.readUInt16LE(offset);
		offset += 2;
		const { zones, offset: readZonesOffset } = readZones(buffer, zoneCount, offset, protocolVersion);
		this.zones = zones;
		offset = readZonesOffset;
        
        //Get the LED count
		const ledCount = buffer.readUInt16LE(offset);
		offset += 2;
        
        //Loop through the available LEDs and the name and value of each
		this.leds = []
		for (let ledIndex = 0; ledIndex < ledCount; ledIndex++) {

            //LED Name
			const { text, length } = readString(buffer, offset);
			offset += length;

            //LED Value
			const value = buffer.readUInt32LE(offset);
			offset += 4;

			this.leds.push({name: text,value});
		}

        //Get colour count & loop through to get each colour
		const colorCount = buffer.readUInt16LE(offset);
		offset += 2;
		this.colors = []
		for (let colorIndex = 0; colorIndex < colorCount; colorIndex++) {
			this.colors.push(readColor(buffer, offset));
			offset += 4;
		}
    }
}

/**
 * Using a given buffer, count of modes, the current reading offest & protocol version decode the modes available for a device
 * @param buffer 
 * @param modeCount 
 * @param offset 
 * @param protocolVersion 
 * @returns 
 */
function readModes (buffer: Buffer, modeCount: number, offset: number, protocolVersion: number) {

    const modes: Mode[] = [];

    //Loop through to the number of available modes
    for (let modeIndex = 0; modeIndex < modeCount; modeIndex++) {

        //Read mode name & value from buffer
        let { text: modeName, length: modeNameLength } = readString(buffer, offset);
        offset += modeNameLength;
        let modeValue = buffer.readInt32LE(offset);
        offset += 4;

        //Read mode flags, and the speeds
        let modeFlags 	= buffer.readUInt32LE(offset);
        let speedMin 	= buffer.readUInt32LE(offset + 4);
        let speedMax 	= buffer.readUInt32LE(offset + 8);

        //If on Protocol 3 or higher, we can get the brightness minumums and maximums
        let brightnessMin;
        let brightnessMax;
        if (protocolVersion >= 3) {
            brightnessMin = buffer.readUInt32LE(offset + 12);
            brightnessMax = buffer.readUInt32LE(offset + 16);
            offset += 8;
        }

        //Get the min and max colour and speed
        let colorMin = buffer.readUInt32LE(offset + 12);
        let colorMax = buffer.readUInt32LE(offset + 16);
        let speed = buffer.readUInt32LE(offset + 20);

        //Again if on protocol 3 or higher we can get the brightness
        let brightness;
        if (protocolVersion >= 3) {
            brightness = buffer.readUInt32LE(offset + 24);
            offset += 4;
        }

        //Get a few more attribs
        let direction 	= buffer.readUInt32LE(offset + 24);
        let colorMode 	= buffer.readUInt32LE(offset + 28);
        offset += 32;
        let colorLength = buffer.readUInt16LE(offset);
        offset += 2;

        let colors: RGBColor[] = [];
        let flagList: string[] = [];

        //Available flags in OpenRGB
        const flags = ["speed", "directionLR", "directionUD", "directionHV", "brightness", "perLedColor", "modeSpecificColor", "randomColor", "manualSave", "automaticSave"];

        //Use the above to create a lookup
        let flagcheck_str: string = modeFlags.toString(2);
        let flagcheck: string[] = Array(flags.length - flagcheck_str.length).concat(flagcheck_str.split("")).reverse();
        flagcheck.forEach((el, i) => {
            if (el == "1") flagList.push(flags[i] as string)
        })

        //Using the lookup decide what mode functions we have

        if (Number(flagcheck[1]) || Number(flagcheck[2]) || Number(flagcheck[3])) {
            flagList.push("direction");
        }

        if (!Number(flagcheck[0])) {
            speedMin = 0;
            speedMax = 0;
            speed = 0;
        }

        if (protocolVersion >= 3 && !Number(flagcheck[4])) {
            brightnessMin = 0;
            brightnessMax = 0;
            brightness = 0;
        }

        if (!Number(flagcheck[1]) && !Number(flagcheck[2]) && !Number(flagcheck[3])) {
            direction = 0;
        }

        if ((!Number(flagcheck[5]) && !Number(flagcheck[6]) && !Number(flagcheck[7])) || !colorLength) {
            colorLength = 0;
            colorMin = 0;
            colorMax = 0;
        }

        //Get the colours available
        for (let colorIndex = 0; colorIndex < colorLength; colorIndex++) {
            colors.push(readColor(buffer, offset));
            offset += 4;
        }

        //Create mode object and return
        let mode: Mode = {
            id: modeIndex,
            name: modeName,
            value: modeValue,
            flags: modeFlags,
            speedMin,
            speedMax,
            colorMin,
            colorMax,
            speed,
            direction,
            colorMode,
            colors,
            flagList
        }

        //If protocol 3 or greater we can assign those protocol specific attribs from earlier
        if (protocolVersion >= 3) {
            mode.brightnessMin = brightnessMin
            mode.brightnessMax = brightnessMax
            mode.brightness = brightness
        }

        modes.push(mode);
    }
    return { modes, offset };
}

/**
 * Using a given buffer, count of zones, the current reading offset & protocol version decode the available zones for a device
 * @param buffer 
 * @param zoneCount 
 * @param offset 
 * @param protocolVersion 
 * @returns 
 */
function readZones (buffer: Buffer, zoneCount: number, offset: number, protocolVersion: number) {

    const zones: Zone[] = [];

    //Loop through to the number of available modes
    for (let zoneIndex = 0; zoneIndex < zoneCount; zoneIndex++) {
        
        //Read zone name & value from buffer
        const { text: zoneName, length: zoneNameLength } = readString(buffer, offset);
        offset += zoneNameLength;
        const zoneType = buffer.readInt32LE(offset);
        offset += 4;
        
        //Read LED info
        const ledsMin   = buffer.readUInt32LE(offset);
        const ledsMax   = buffer.readUInt32LE(offset + 4);
        const ledsCount = buffer.readUInt32LE(offset + 8);
        offset += 12
        const resizable = !(ledsMin == ledsMax);

        //Get matrix sizes (if applicable)
        let matrixSize = buffer.readUInt16LE(offset);
        offset+=2;

        //If there is a matrix zone, decode 
        let matrix: Matrix|undefined;
        if (matrixSize) {
            matrix = {
                size: matrixSize / 4 - 2,
                height: buffer.readUInt32LE(offset),
                width: buffer.readUInt32LE(offset + 4),
                keys: []
            };

            offset += 8;

            matrix.keys = [];
            for (let index = 0; index < matrix.height; index++) {
                matrix.keys[index] = [];
                for (let i = 0; i < matrix.width; i++) {
                    let led = buffer.readUInt32LE(offset);
                    matrix.keys[index]!.push(led != 0xFFFFFFFF ? led : undefined);
                    offset += 4;
                }
            }
        }

        //If protocol 4 or higher, we can get segment information from buffer
        let segments: Segment[]|undefined
        if (protocolVersion >= 4) {
            segments = [];
            const segmentCount = buffer.readUInt16LE(offset);
            offset += 2;
            for (let i = 0; i < segmentCount; i++) {
                let name = readString(buffer, offset);
                offset += name.length;
                segments.push({
                    name: name.text,
                    type: buffer.readInt32LE(offset),
                    start: buffer.readUInt32LE(offset + 4),
                    length: buffer.readUInt32LE(offset + 8),
                });
                offset += 12;
            }
        }

        //Create the zone object and return
        let zone: Zone = {
            name: zoneName,
            id: zoneIndex,
            type: zoneType,
            ledsMin,
            ledsMax,
            ledsCount,
            resizable,
            matrix,
            segments
        };

        zones.push(zone);
    }
    return { zones, offset };
}

/**
 * Read a string from a given buffer and offset and return the retrieved string and new offset
 * @param buffer 
 * @param offset 
 * @returns 
 */
function readString (buffer: Buffer, offset: number) {
	const length: number = buffer.readUInt16LE(offset);
	const text: string = new TextDecoder().decode(buffer.slice(offset + 2, offset + length + 1));
	return { text, length: length + 2 };
}

/**
 * Read a colour {R,G,B} from a given buffer and offset and return the retrieved {R,G,B}
 * @param buffer 
 * @param offset 
 * @returns 
 */
function readColor (buffer: Buffer, offset: number) {
	const red: number = buffer.readUInt8(offset++)
	const green: number = buffer.readUInt8(offset++)
	const blue: number = buffer.readUInt8(offset++)
	return { red, green, blue }
}