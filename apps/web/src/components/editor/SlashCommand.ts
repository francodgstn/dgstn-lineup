import { Extension } from '@tiptap/core'
import { Suggestion } from '@tiptap/suggestion'

// Notion-style "/" slash command. The actual command list + popup rendering is
// injected via `configure({ suggestion: { items, render } })` from the editor,
// so it can use React/i18n/upload handlers from component scope.
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        // props is the selected command item; run its command with the editor + range
        command: ({ editor, range, props }: { editor: unknown; range: unknown; props: { command: (args: { editor: unknown; range: unknown }) => void } }) => {
          props.command({ editor, range })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
