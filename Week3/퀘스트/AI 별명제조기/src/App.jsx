import { useState, useEffect } from 'react'

const STYLES = [
  { id: 'cute', label: '귀여운 동물 이름 스타일' },
  { id: 'game', label: '게임 캐릭터 느낌' },
  { id: 'hip', label: '힙한 영어 닉네임' },
  { id: 'mz', label: '급식체 스타일' },
  { id: 'fantasy', label: '판타지 용사 스타일' },
]

function NicknameCard({ item, index, apiKey, style, personality, hobby }) {
  const [copied, setCopied] = useState(false)
  const [selected, setSelected] = useState(false)
  const [imageUrl, setImageUrl] = useState(null)
  const [imgLoading, setImgLoading] = useState(false)
  const [imgError, setImgError] = useState('')

  const handleCopy = () => {
    navigator.clipboard.writeText(item.nickname)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleGenerateCharacter = async () => {
    setImgLoading(true)
    setImgError('')
    setImageUrl(null)
    try {
      const res = await fetch('/api/generate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          nickname: item.nickname,
          reason: item.reason,
          style,
          personality,
          hobby,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '오류 발생')
      setImageUrl(data.imageUrl)
    } catch (e) {
      setImgError(e.message)
    } finally {
      setImgLoading(false)
    }
  }

  return (
    <div
      className={`rounded-xl border transition-all duration-200 overflow-hidden ${
        selected
          ? 'border-violet-500 bg-violet-900/30 shadow-lg shadow-violet-500/20'
          : 'border-slate-700 bg-slate-800/60 hover:border-slate-600'
      }`}
    >
      {/* 캐릭터 이미지 영역 */}
      {imageUrl && (
        <div className="w-full">
          <img src={imageUrl} alt={item.nickname} className="w-full object-cover max-h-72" />
        </div>
      )}
      {imgLoading && (
        <div className="w-full h-48 flex flex-col items-center justify-center bg-slate-700/50 gap-3">
          <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">캐릭터 그리는 중... 🎨</p>
        </div>
      )}
      {imgError && (
        <div className="px-5 pt-4 text-xs text-red-400 bg-red-900/10">{imgError}</div>
      )}

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-violet-400 bg-violet-900/40 px-2 py-0.5 rounded-full">
                #{index + 1}
              </span>
              <span className="text-xl font-bold text-white">{item.nickname}</span>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">{item.reason}</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleCopy}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              copied
                ? 'bg-green-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {copied ? '복사됨! ✓' : '복사'}
          </button>
          <button
            onClick={() => setSelected(!selected)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              selected
                ? 'bg-violet-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-violet-700 hover:text-white'
            }`}
          >
            {selected ? '선택됨 ★' : '선택'}
          </button>
          <button
            onClick={handleGenerateCharacter}
            disabled={imgLoading}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-all bg-pink-700 text-white hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {imgLoading ? '생성 중...' : imageUrl ? '재생성 🎨' : '캐릭터 생성 🎨'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [apiKey, setApiKey] = useState('')
  const [name, setName] = useState('')
  const [personality, setPersonality] = useState('')
  const [hobby, setHobby] = useState('')
  const [selectedStyle, setSelectedStyle] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('openai_api_key')
    if (saved) setApiKey(saved)
  }, [])

  const handleApiKeyChange = (e) => {
    setApiKey(e.target.value)
    localStorage.setItem('openai_api_key', e.target.value)
  }

  const handleGenerate = async () => {
    if (!apiKey) { setError('Gemini API Key를 입력해주세요.'); return }
    if (!name) { setError('이름을 입력해주세요.'); return }
    if (!selectedStyle) { setError('스타일을 선택해주세요.'); return }
    setError('')
    setLoading(true)
    setResults([])
    try {
      const res = await fetch('/api/generate-nicknames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, name, personality, hobby, style: selectedStyle }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '서버 오류가 발생했습니다.')
      setResults(data.nicknames)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-white whitespace-nowrap">🏷️ AI 별명 생성기</h1>
          <div className="flex-1 w-full sm:w-auto flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={handleApiKeyChange}
              placeholder="OpenAI API Key 입력"
              className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
            />
            {apiKey && (
              <button
                onClick={() => {
                  setApiKey('')
                  localStorage.removeItem('openai_api_key')
                }}
                className="px-3 py-2 bg-slate-700 hover:bg-red-800 text-slate-400 hover:text-white rounded-lg text-sm transition-all"
                title="API Key 삭제"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* Input Form */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-200">내 정보 입력</h2>

          <div>
            <label className="block text-sm text-slate-400 mb-1">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름을 입력하세요"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">성격</label>
            <input
              type="text"
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="예: 활발한, 조용한, 유머러스한..."
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">취미</label>
            <input
              type="text"
              value={hobby}
              onChange={(e) => setHobby(e.target.value)}
              placeholder="예: 게임, 독서, 운동..."
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">별명 스타일 *</label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedStyle(s.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    selectedStyle === s.id
                      ? 'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/30'
                      : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-violet-500 hover:text-violet-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-4 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-base shadow-lg shadow-violet-500/20"
          >
            {loading ? '생성 중...' : '별명 생성하기 ✨'}
          </button>
        </section>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12 text-slate-400 text-lg animate-pulse">
            AI가 별명을 만들고 있어요... 🎲
          </div>
        )}

        {/* Results */}
        {results.length > 0 && !loading && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-200">생성된 별명 {results.length}개</h2>
              <button
                onClick={handleGenerate}
                className="text-sm text-violet-400 hover:text-violet-300 border border-slate-700 hover:border-violet-500 px-3 py-1.5 rounded-lg transition-all"
              >
                다시 생성 🔄
              </button>
            </div>
            <div className="grid gap-3">
              {results.map((item, i) => (
                <NicknameCard
                  key={i}
                  item={item}
                  index={i}
                  apiKey={apiKey}
                  style={selectedStyle}
                  personality={personality}
                  hobby={hobby}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
