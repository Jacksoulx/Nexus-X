import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        circuit: {
          bg: "#070A0F",
          panel: "#0D121C",
          line: "#243041",
          cyan: "#2DE2E6",
          green: "#72F2A1",
          amber: "#F6C453",
          rose: "#FF4D8D"
        }
      },
      boxShadow: {
        neon: "0 0 30px rgba(45, 226, 230, 0.18)",
        green: "0 0 24px rgba(114, 242, 161, 0.16)"
      }
    }
  },
  plugins: []
};

export default config;
