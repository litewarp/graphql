import dotProp from "dot-prop";
import { Context } from "../types";

export default class ContextParser {
    public static parseTag(value: string, tagName: "context" | "jwt"): string | undefined {
        const [, path] = value?.split?.(`$${tagName}.`) || [];
        return path;
    }

    public static getContextProperty(path: string, context: Context): string | undefined {
        return dotProp.get({ value: context }, `value.${path}`);
    }

    public static getJwtPropery(path: string, context: Context): string | undefined {
        return ContextParser.getContextProperty(`jwt.${path}`, context);
    }
}
