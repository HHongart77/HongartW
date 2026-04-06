import { useState, useRef, useEffect } from 'react'

const INITIAL_MESSAGE = {
  role: 'assistant',
  content: '마, 왔나? 자전거 관련이면 뭐든 물어봐라. 딴 거 물어보면 모른다 아이가~ 🚴‍♂️'
}

export default function App() {
  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const resetChat = () => {
    setMessages([INITIAL_MESSAGE])
  }

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMessage = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || '응답 오류')
      }

      setMessages([...newMessages, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `에러났다 아이가... ${err.message} 다시 해봐라.`
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* 헤더 */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-yellow-400">
            🚴 UCI 자전거 전문가 - 철수 형님
          </h1>
          <button
            onClick={resetChat}
            title="대화 초기화"
            className="text-gray-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-gray-700 flex items-center gap-1 text-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            초기화
          </button>
        </div>
      </header>

      {/* 채팅 영역 */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="flex flex-col items-start max-w-[80%]">
                  <span className="text-xs text-gray-400 mb-1 ml-1">🚴 철수 형님</span>
                  <div className="bg-gray-700 text-white px-4 py-3 rounded-2xl rounded-tl-none text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              )}
              {msg.role === 'user' && (
                <div className="max-w-[80%]">
                  <div className="bg-blue-600 text-white px-4 py-3 rounded-2xl rounded-tr-none text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex flex-col items-start max-w-[80%]">
                <span className="text-xs text-gray-400 mb-1 ml-1">🚴 철수 형님</span>
                <div className="bg-gray-700 text-white px-4 py-3 rounded-2xl rounded-tl-none text-sm">
                  <span className="animate-pulse">철수 형님이 답변 준비 중... 🚴</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 입력 영역 */}
      <footer className="bg-gray-800 border-t border-gray-700 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            rows={1}
            placeholder="자전거에 대해 물어보세요..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-gray-700 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-600 focus:outline-none focus:border-yellow-400 placeholder-gray-400 resize-none max-h-32"
            style={{ overflowY: 'auto' }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold px-4 py-2.5 rounded-xl transition-colors flex-shrink-0 text-sm"
          >
            전송
          </button>
        </div>
      </footer>
    </div>
  )
}
