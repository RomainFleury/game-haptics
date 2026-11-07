import { NavLink } from "react-router-dom";

export function Navigation() {
  return (
    <nav className="bg-slate-800/80 border-b border-slate-700 px-4 md:px-6 shrink-0">
      <div className="flex gap-1 overflow-x-auto">
        <NavLink
          to="/games"
          className={({ isActive }) =>
            `px-3 md:px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-slate-400 hover:text-slate-200"
            }`
          }
        >
          Games
        </NavLink>
        <NavLink
          to="/debug"
          className={({ isActive }) =>
            `px-3 md:px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-slate-400 hover:text-slate-200"
            }`
          }
        >
          Debug
        </NavLink>
        <NavLink
          to="/recoil"
          end
          className={({ isActive }) =>
            `px-3 md:px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-slate-400 hover:text-slate-200"
            }`
          }
        >
          Recoil
        </NavLink>
        <NavLink
          to="/recoil-link"
          className={({ isActive }) =>
            `px-3 md:px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-slate-400 hover:text-slate-200"
            }`
          }
        >
          Kit Setup
        </NavLink>
        <NavLink
          to="/daemon-settings"
          className={({ isActive }) =>
            `px-3 md:px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-slate-400 hover:text-slate-200"
            }`
          }
        >
          Daemon
        </NavLink>
        <NavLink
          to="/vests"
          className={({ isActive }) =>
            `px-3 md:px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-slate-400 hover:text-slate-200"
            }`
          }
        >
          Vests
        </NavLink>
        <NavLink
          to="/mini-games"
          className={({ isActive }) =>
            `px-3 md:px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-slate-400 hover:text-slate-200"
            }`
          }
        >
          Mini-Games
        </NavLink>
      </div>
    </nav>
  );
}

