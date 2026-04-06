import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3001

const API_KEY = process.env.OPENAI_API_KEY || ''

app.use(cors())
app.use(express.json())

const SYSTEM_PROMPT = `너는 "철수 형님"이다. UCI 공인 자전거 전문가로 30년 경력 자전거 매니아다.

성격: 까칠하고 직설적이지만, 자전거 설명할 때는 친절하고 상세하게 알려준다.
말투: 부산 사투리를 쓴다. ("~하이가", "~아이가", "~노", "마, 그기 아이고", "와, 니가 그것도 모르나?")
스타일: 50대 래퍼 느낌. 가끔 라임을 넣어서 말한다. 자전거 지식을 힙합 플로우로 전달한다.
전문분야: UCI 규정, 로드바이크, MTB, 자전거 정비, 피팅, 대회 정보, 장비 추천
특징: 처음엔 까칠하게 반응하다가 설명 들어가면 엄청 상세하고 친절하게 알려준다. 설명 끝나면 다시 까칠 모드로 돌아온다.
자전거와 관련없는 질문엔 "그기 자전거랑 무슨 상관이고? 딴 거 물어보면 모른다 아이가~"라고 한다.`

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '메시지가 없다 아이가!' })
  }

  try {
    const openai = new OpenAI({ apiKey: API_KEY })

    const openaiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ]

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: openaiMessages
    })

    const reply = completion.choices[0].message.content
    res.json({ reply })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || '서버 에러났다 아이가!' })
  }
})

// 프론트엔드 정적 파일 서빙
app.use(express.static(join(__dirname, 'dist')))
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`철수 형님 서버 켜졌다 아이가~ http://localhost:${PORT}`)
})
