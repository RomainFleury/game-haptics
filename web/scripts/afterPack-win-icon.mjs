/**
 * Apply the Windows .exe icon after packaging.
 *
 * electron-builder only runs rcedit when signAndEditExecutable is true, but
 * that path pulls winCodeSign and hits symlink privilege errors on Windows.
 * We keep signing/editing disabled and set the icon here instead.
 */
import { rcedit } from "rcedit";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, "..");
const iconPath = join(webDir, "public", "icon.ico");

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  if (!existsSync(iconPath)) {
    console.warn(`[afterPack-win-icon] Icon not found: ${iconPath}`);
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = join(context.appOutDir, exeName);
  if (!existsSync(exePath)) {
    console.warn(`[afterPack-win-icon] Executable not found: ${exePath}`);
    return;
  }

  console.log(`[afterPack-win-icon] Setting icon on ${exeName}`);
  await rcedit(exePath, { icon: iconPath });
}
