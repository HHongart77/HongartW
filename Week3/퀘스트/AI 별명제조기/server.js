import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = 3002

app.use(cors())
app.use(express.json())

// Serve static frontend build
app.use(express.static(join(__dirname, 'dist')))

app.post('/api/generate-nicknames', async (req, res) => {
  const { apiKey, name, personality, hobby, style } = req.body

  if (!apiKey) return res.status(400).json({ error: 'API Key가 필요합니다.' })
  if (!name) return res.status(400).json({ error: '이름이 필요합니다.' })

  try {
    const openai = new OpenAI({ apiKey })

    const styleLabels = {
      cute: '귀여운 동물 이름 스타일',
      game: '게임 캐릭터 느낌',
      hip: '힙한 영어 닉네임',
      mz: '급식체 스타일',
      fantasy: '판타지 용사 스타일',
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: '너는 재미있는 별명을 만들어주는 전문가야. 사용자 정보를 바탕으로 창의적이고 재미있는 별명 5개를 만들어줘. 각 별명에 왜 그 별명을 추천하는지 짧은 설명도 붙여줘. 반드시 JSON 배열로 응답해. 형식: [{ "nickname": "별명", "reason": "이유" }]',
        },
        {
          role: 'user',
          content: `이름: ${name}, 성격: ${personality || '없음'}, 취미: ${hobby || '없음'}, 스타일: ${styleLabels[style] || style}로 별명 5개 만들어줘`,
        },
      ],
      response_format: { type: 'json_object' },
    })

    const text = response.choices[0].message.content
    const parsed = JSON.parse(text)

    // 배열 형태 추출 (루트가 배열이거나 객체 안에 배열이 있을 경우 모두 처리)
    const nicknames = Array.isArray(parsed) ? parsed : Object.values(parsed)[0]
    res.json({ nicknames })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message || 'AI 생성 중 오류가 발생했습니다.' })
  }
})

app.post('/api/generate-character', async (req, res) => {
  const { apiKey, nickname, reason, style, personality, hobby } = req.body

  if (!apiKey) return res.status(400).json({ error: 'API Key가 필요합니다.' })

  const stylePrompts = {
    cute: 'cute chibi animal character, pastel colors, adorable, kawaii style',
    game: 'game character, pixel art inspired, heroic pose, vibrant colors, RPG style',
    hip: 'cool urban character, streetwear fashion, modern hip-hop style, stylish',
    mz: 'funny meme-style character, Gen Z aesthetic, bold colors, energetic',
    fantasy: 'epic fantasy warrior character, magical aura, fantasy RPG illustration, dramatic lighting',
  }

  const styleDesc = stylePrompts[style] || 'colorful cartoon character'
  const prompt = `A character illustration for someone nicknamed "${nickname}". ${reason}. Style: ${styleDesc}. Personality: ${personality || 'fun'}. Hobby: ${hobby || 'various activities'}. Clean background, character design, digital art, high quality.`

  try {
    const openai = new OpenAI({ apiKey })
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    })
    res.json({ imageUrl: response.data[0].url })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message || '캐릭터 생성 중 오류가 발생했습니다.' })
  }
})

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`)
})
