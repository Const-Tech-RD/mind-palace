import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** An answer from Claude, rendered as GitHub-flavoured Markdown (tables, strikethrough, bare links). Links open in the browser. */
export function Answer({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // A wide table scrolls inside the bubble instead of stretching it.
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
