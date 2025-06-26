import type { RGBColor} from "./RGBColor.ts";

export interface ModeInput {
    id?: number
    name?: string
    value?: number
    flags?: number
    speedMin?: number
    speedMax?: number
    brightnessMin?: number
    brightnessMax?: number
    colorMin?: number
    colorMax?: number
    speed?: number
    brightness?: number
    direction?: number
    colorMode?: number
    colors?: RGBColor[]
}