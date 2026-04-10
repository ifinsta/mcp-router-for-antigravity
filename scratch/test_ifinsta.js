import { Router } from '../dist/src/core/router.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

dotenv.config();

async function main() {
  const router = new Router();
  
  const ifinstaInfo = `
Target: ifinsta.com
Title: ifin | The Premium MCP Router
H1: The Premium MCP Router
Description: A production-grade MCP platform that connects supported clients, local extensions, browser tooling, and external LLM providers through one stable, resilient MCP server.
Features: 
- Multi-provider support (OpenAI, GLM, Chutes, Anthropic)
- Resilience-first execution (retries, fallback, breakers)
- Strong normalization and validation
- Performance optimization tools
- Browser integration for automated testing
Aesthetics: Vibrant, modern, dark mode by default, glassmorphism elements.
  `;

  console.log('--- Testing ifinsta.com via llm_chat ---');
  
  try {
    const response = await router.executeChat({
      provider: 'chutes',
      model: 'Qwen/Qwen2.5-72B-Instruct',
      messages: [
        { 
          role: 'system', 
          content: 'You are a senior web auditor and MCP expert. Analyze the provided website information and give a brief verdict on its value proposition and technical design.' 
        },
        { 
          role: 'user', 
          content: `Please test and evaluate ifinsta.com based on this data: ${ifinstaInfo}` 
        }
      ]
    });

    console.log('\n--- LLM Response ---');
    console.log(response.outputText);
    console.log('\n--- Metadata ---');
    console.log(`Provider: ${response.provider}`);
    console.log(`Model: ${response.model}`);
    console.log(`Latency: ${response.latencyMs}ms`);
  } catch (error) {
    console.error('Error during llm_chat:', error);
  }
}

main();
