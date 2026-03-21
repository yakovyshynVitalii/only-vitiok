export default defineAppConfig({
  ui: {
    colors: {
      primary: "sky",
      neutral: "slate",
    },
    button: {
      defaultVariants: {
        size: "md",
      },
    },
    input: {
      defaultVariants: {
        size: "md",
      },
    },
    textarea: {
      defaultVariants: {
        size: "md",
      },
    },
    drawer: {
      slots: {
        content: "max-w-none w-screen h-screen rounded-none",
      },
    },
  },
});
