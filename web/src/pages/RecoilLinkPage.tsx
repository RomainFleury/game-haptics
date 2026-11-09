import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  recoilFirmwareListImages,
  recoilFirmwareListTargets,
  recoilListPorts,
  recoilStatus,
  type RecoilFirmwareImage,
  type RecoilFirmwareTarget,
  type RecoilLinkStatus,
  type RecoilSerialHint,
  type RelayPortInfo,
} from "../lib/bridgeApi";

const POLL_MS = 2000;

function isReceiverBootloader(t: RecoilFirmwareTarget): boolean {
  if (t.suggestedRole === "receiver" || t.suggestedRole === "receiver_nosd") return true;
  const label = (t.volumeLabel || "").toUpperCase();
  return label.includes("NICENANO") || label.includes("NICE!NANO");
}

function driveLabel(t: RecoilFirmwareTarget): string {
  const letter = t.driveLetter ? `${t.driveLetter}:` : "";
  const name = t.volumeLabel || "UF2";
  return letter ? `${letter} ${name}` : name;
}

function statusBoxClass(tone: "ready" | "ok" | "idle"): string {
  if (tone === "ready") return "bg-emerald-500/10 ring-emerald-500/40";
  if (tone === "ok") return "bg-sky-500/10 ring-sky-500/40";
  return "bg-slate-900/60 ring-white/5";
}

function badgeClass(tone: "ready" | "ok" | "idle"): string {
  if (tone === "ready")
    return "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/50";
  if (tone === "ok") return "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/50";
  return "bg-slate-700 text-slate-300 ring-1 ring-slate-600";
}

const SHOPPING_LIST = [
  {
    title: "Nordic nRF52840 Dongle PCA10059",
    qty: "1",
    role: "Emitter",
    note: "Blue USB-A stick, Nordic logo. This kit stays on this board. Sideways RESET starts Open DFU. It never shows a UF2 disk.",
  },
  {
    title: "Nice!Nano-style nRF52840",
    qty: "1",
    role: "Receiver",
    note: "USB-C, Pro Micro pins, no reset button. Short RST to GND twice. The disk name is NICENANO. If INFO_UF2.TXT lists a SoftDevice, install Receiver (SoftDevice).",
  },
  {
    title: "JF-0826B solenoid",
    qty: "1",
    role: "Actuator",
    note: "12 V coil. A shot is a 25 ms pulse. A reload hold can run up to 20 s. The receiver then forces 10 s off.",
  },
  {
    title: "12 V battery",
    qty: "1",
    role: "Coil power",
    note: "Powers the solenoid only. 12 V never goes to the receiver.",
  },
  {
    title: "Buck converter, set to 5.0 V",
    qty: "1",
    role: "Receiver power",
    note: "Plus goes to the RAW hole only. Do not use the B+ pad. Do not use the 3.3 V pin.",
  },
  {
    title: "IRLZ44N MOSFET",
    qty: "1",
    role: "Switch",
    note: "TO-220, plastic face, legs down: left gate, middle drain, right source. It fired a 25 ms pulse and stayed cold on this bench. For a long hold, a FET rated at 2.5 V gate (AO3400A) runs cooler.",
  },
  {
    title: "100 kΩ and 100 Ω",
    qty: "1 each",
    role: "Gate",
    note: "100 kΩ links gate to source. 100 Ω links receiver pin P0.10 to the gate only.",
  },
  {
    title: "Flyback diode",
    qty: "1",
    role: "Coil",
    note: "Across the solenoid leads. The stripe points at battery plus.",
  },
] as const;

export function RecoilLinkPage() {
  const [ports, setPorts] = useState<RelayPortInfo[]>([]);
  const [targets, setTargets] = useState<RecoilFirmwareTarget[]>([]);
  const [serialHints, setSerialHints] = useState<RecoilSerialHint[]>([]);
  const [images, setImages] = useState<RecoilFirmwareImage[]>([]);
  const [link, setLink] = useState<RecoilLinkStatus | null>(null);

  const receiverBoot = useMemo(() => targets.find(isReceiverBootloader) ?? null, [targets]);
  const openDfuHints = useMemo(
    () => serialHints.filter((h) => h.mode === "open_dfu"),
    [serialHints]
  );
  const recoilTxHints = useMemo(
    () => serialHints.filter((h) => h.mode === "recoil_tx"),
    [serialHints]
  );
  const recoilPorts = useMemo(() => ports.filter((p) => p.likely_recoil), [ports]);
  const hasDongleImage = images.some((img) => img.role === "dongle");
  const hasReceiverImage = images.some(
    (img) => img.role === "receiver" || img.role === "receiver_nosd"
  );
  const emitterFlashed = recoilTxHints.length > 0 || recoilPorts.length > 0;
  const linkConnected = Boolean(link?.connected);

  const refresh = useCallback(async () => {
    try {
      const [portRes, tgtRes, imgRes, statusRes] = await Promise.all([
        recoilListPorts(),
        recoilFirmwareListTargets(),
        recoilFirmwareListImages(),
        recoilStatus(),
      ]);
      if (portRes.success) setPorts(portRes.ports);
      if (tgtRes.success) {
        setTargets(tgtRes.targets || []);
        setSerialHints(tgtRes.serialHints || []);
      }
      if (imgRes.success) setImages(imgRes.images || []);
      if (statusRes.success) setLink(statusRes.recoil ?? null);
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const nextStep = useMemo(() => {
    if (openDfuHints.length > 0) {
      return {
        title: "Emitter is in Open DFU",
        body: `Red-pulse DFU on ${openDfuHints.map((h) => h.port).join(", ")}. Open the firmware installer to flash it.`,
        cta: { to: "/recoil-link/flash?board=emitter", label: "Open firmware installer" },
      };
    }
    if (receiverBoot) {
      return {
        title: "Receiver UF2 volume detected",
        body: `${driveLabel(receiverBoot)} is ready. Open the firmware installer to flash the receiver.`,
        cta: { to: "/recoil-link/flash?board=receiver", label: "Open firmware installer" },
      };
    }
    if (linkConnected) {
      return {
        title: "TSC Recoil Link is connected",
        body: `Linked on ${link?.port || "COM"}. Use the Recoil page for pulse and click tests.`,
        cta: { to: "/recoil", label: "Open Recoil" },
      };
    }
    if (emitterFlashed) {
      return {
        title: "Emitter looks flashed",
        body: "TSC Recoil Link is on USB. Connect it on the Recoil page. Flash the receiver from the installer if needed.",
        cta: { to: "/recoil", label: "Open Recoil to connect" },
      };
    }
    return {
      title: "No kit hardware seen yet",
      body: "Plug the emitter (or put a board in bootloader). Flash firmware only from the installer page.",
      cta: { to: "/recoil-link/flash", label: "Open firmware installer" },
    };
  }, [openDfuHints, receiverBoot, linkConnected, link?.port, emitterFlashed]);

  const emitterTone = openDfuHints.length
    ? ("ready" as const)
    : linkConnected || emitterFlashed
      ? ("ok" as const)
      : ("idle" as const);
  const receiverTone = receiverBoot ? ("ready" as const) : ("idle" as const);

  const emitterLabel = openDfuHints.length
    ? "Open DFU"
    : linkConnected
      ? "Connected"
      : emitterFlashed
        ? "TSC Recoil Link"
        : "Not seen";
  const receiverLabel = receiverBoot ? "UF2 ready" : "Not seen";

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Kit Setup</h1>
          <p className="mt-2 text-sm md:text-base text-slate-400 max-w-2xl">
            Hardware status and parts list. Firmware install is a separate page. Pulse / click on{" "}
            <Link to="/recoil" className="text-sky-400 hover:text-sky-300">
              Recoil
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            className="rounded-lg border border-slate-500 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
          <Link
            to="/recoil-link/flash"
            className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            Firmware installer
          </Link>
        </div>
      </header>

      <section className="rounded-2xl bg-sky-500/10 p-4 ring-1 ring-sky-500/30 space-y-3">
        <p className="text-xs uppercase tracking-wide text-sky-300">Status</p>
        <h2 className="text-lg font-semibold text-white">{nextStep.title}</h2>
        <p className="text-sm text-slate-300">{nextStep.body}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            to={nextStep.cta.to}
            className="inline-flex rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            {nextStep.cta.label}
          </Link>
        </div>
        <p className="text-xs text-slate-500">
          Firmware packages on disk: {hasDongleImage ? "emitter OK" : "emitter missing"} ·{" "}
          {hasReceiverImage ? "receiver OK" : "receiver missing"}.
        </p>
      </section>

      <div>
        <div className="mb-3">
          <p className="text-sm uppercase tracking-wide text-slate-400">USB watcher</p>
          <h2 className="text-xl font-semibold text-white">Boards seen</h2>
          <p className="mt-1 text-sm text-slate-400">
            Read-only. To flash, use the firmware installer.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
          <section
            className={`rounded-2xl p-4 md:p-5 ring-1 flex flex-col gap-4 min-h-[14rem] ${statusBoxClass(emitterTone)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-wide text-slate-400">Emitter</p>
                <h3 className="text-lg font-semibold text-white">Nordic PCA10059</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Sideways RESET → Open DFU. Normal plug → TSC Recoil Link CDC.
                </p>
              </div>
              <span
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${badgeClass(emitterTone)}`}
              >
                {emitterLabel}
              </span>
            </div>

            <div className="rounded-xl bg-slate-950/40 px-3 py-3 text-sm min-h-[4.5rem] ring-1 ring-white/5 mt-auto">
              <p className={emitterTone === "idle" ? "text-slate-400" : "text-slate-100"}>
                {openDfuHints.length > 0
                  ? `Open DFU on ${openDfuHints
                      .map((h) => `${h.port} (${h.vidPid})`)
                      .join(", ")}.`
                  : linkConnected
                    ? `Connected in daemon on ${link?.port || "COM"}${
                        link?.last_error ? ` — ${link.last_error}` : ""
                      }.`
                    : emitterFlashed
                      ? `TSC Recoil Link on ${
                          recoilTxHints.map((h) => h.port).join(", ") ||
                          recoilPorts.map((p) => p.device).join(", ")
                        }. Not connected yet — use Recoil.`
                      : "Waiting for dongle COM port…"}
              </p>
            </div>
          </section>

          <section
            className={`rounded-2xl p-4 md:p-5 ring-1 flex flex-col gap-4 min-h-[14rem] ${statusBoxClass(receiverTone)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-wide text-slate-400">Receiver</p>
                <h3 className="text-lg font-semibold text-white">Nice!Nano</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Bootloader volume only (no USB product string when running).
                </p>
              </div>
              <span
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${badgeClass(receiverTone)}`}
              >
                {receiverLabel}
              </span>
            </div>

            <div className="rounded-xl bg-slate-950/40 px-3 py-3 text-sm min-h-[4.5rem] ring-1 ring-white/5 mt-auto">
              <p className={receiverBoot ? "text-emerald-100" : "text-slate-400"}>
                {receiverBoot
                  ? `UF2 volume ${driveLabel(receiverBoot)}${
                      receiverBoot.reason ? ` — ${receiverBoot.reason}` : ""
                    }`
                  : "No NICENANO drive. Running receivers are radio-only (not listed here)."}
              </p>
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-400">Parts</p>
          <h2 className="text-xl font-semibold text-white">Shopping list</h2>
          <p className="mt-1 text-sm text-slate-400">
            Buy these parts. One ground wire joins the MOSFET source, battery minus, buck minus, and a receiver GND hole.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {SHOPPING_LIST.map((item) => (
            <li
              key={item.title}
              className="rounded-xl bg-slate-900/70 px-4 py-3 ring-1 ring-white/5 space-y-1"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-white">{item.title}</p>
                <span className="text-xs uppercase tracking-wide text-slate-500">
                  {item.role} · {item.qty}
                </span>
              </div>
              <p className="text-sm text-slate-400">{item.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
