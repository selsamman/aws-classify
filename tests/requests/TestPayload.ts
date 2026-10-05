import {serializable} from "js-freeze-dry";
export class TestPayload {
    constructor(public label = "", public nested: {items: Array<number | null>} = {items: []}) {}
}
serializable({TestPayload});
