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
      boxShadow: { card: "0 1px 2px rgba(18,34,29,.04), 0 14px 40px rgba(18,34,29,.06)" }
    }
  },
  plugins: []
};
export default config;
