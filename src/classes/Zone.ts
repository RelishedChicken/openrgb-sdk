import { Matrix } from "./Matrix.js";
import { Segment } from "./Segment.js";

export interface Zone {
    name: string
    id: number
    type: number
    ledsMin: number
    ledsMax: number
    ledsCount: number
    resizable: boolean
    matrix?: Matrix
    segments?: Segment[]
}