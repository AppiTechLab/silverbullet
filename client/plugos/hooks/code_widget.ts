import type { Hook, Manifest } from "../types.ts";
import type { System } from "../system.ts";
import type { CodeWidgetT } from "@silverbulletmd/silverbullet/type/manifest";
import type { CodeWidgetCallback } from "@silverbulletmd/silverbullet/type/client";

export class CodeWidgetHook implements Hook<CodeWidgetT> {
  codeWidgetCallbacks = new Map<string, CodeWidgetCallback>();
  codeWidgetModes = new Map<string, "markdown" | "iframe">();
  // Built-in callbacks registered before plug loading; they take final
  // precedence so a broken/outdated plug cannot shadow a native implementation.
  private builtinCallbacks = new Map<string, CodeWidgetCallback>();

  /** Register a built-in code widget that survives plug reloads. */
  registerBuiltin(lang: string, callback: CodeWidgetCallback) {
    this.builtinCallbacks.set(lang, callback);
  }

  collectAllCodeWidgets(system: System<CodeWidgetT>) {
    this.codeWidgetCallbacks.clear();
    for (const plug of system.loadedPlugs.values()) {
      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions,
      )) {
        if (!functionDef.codeWidget) {
          continue;
        }
        this.codeWidgetModes.set(
          functionDef.codeWidget,
          functionDef.renderMode || "iframe",
        );
        this.codeWidgetCallbacks.set(
          functionDef.codeWidget,
          (bodyText, pageName) => {
            return plug.invoke(name, [bodyText, pageName]);
          },
        );
      }
    }
    // Apply builtins last - they override any plug-supplied callback for the
    // same language (e.g. a stale community plug that calls a removed API).
    for (const [lang, cb] of this.builtinCallbacks) {
      this.codeWidgetCallbacks.set(lang, cb);
    }
  }

  apply(system: System<CodeWidgetT>): void {
    this.collectAllCodeWidgets(system);
    system.on({
      plugLoaded: () => {
        this.collectAllCodeWidgets(system);
      },
    });
  }

  validateManifest(manifest: Manifest<CodeWidgetT>): string[] {
    const errors = [];
    for (const functionDef of Object.values(manifest.functions)) {
      if (!functionDef.codeWidget) {
        continue;
      }
      if (typeof functionDef.codeWidget !== "string") {
        errors.push("Codewidgets require a string name.");
      }
    }
    return errors;
  }
}
