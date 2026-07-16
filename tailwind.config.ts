import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12221d",
        municipal: { 50: "#eef7ff", 100: "#d8eeff", 500: "#2DB0FF", 600: "#148fdc", 700: "#0166FF", 900: "#123d77" },
        brandYellow: "#F4DC00",
        sand: "#f5f4ef"
      },
      boxShadow: { card: "0 1px 2px rgba(18,34,29,.04), 0 14px 40px rgba(18,34,29,.06)" },
      transitionDuration: { fast: "150ms", DEFAULT: "250ms", slow: "400ms" },
      transitionTimingFunction: {
        // Curvas compartidas: `out` para entradas (arranca rápido, frena suave),
        // `spring` con un leve overshoot para superficies que "aparecen".
        out: "cubic-bezier(0.22, 1, 0.36, 1)",
        spring: "cubic-bezier(0.34, 1.4, 0.64, 1)"
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "scale-in": { from: { opacity: "0", transform: "translate3d(0,8px,0) scale(.97)" }, to: { opacity: "1", transform: "translate3d(0,0,0) scale(1)" } },
        "slide-in-right": { from: { opacity: "0", transform: "translate3d(24px,0,0)" }, to: { opacity: "1", transform: "translate3d(0,0,0)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } }
      },
      animation: {
        "fade-in": "fade-in 250ms cubic-bezier(0.22,1,0.36,1) both",
        "scale-in": "scale-in 250ms cubic-bezier(0.34,1.4,0.64,1) both",
        "slide-in-right": "slide-in-right 300ms cubic-bezier(0.22,1,0.36,1) both"
      }
    }
  },
  plugins: []
};
export default config;
