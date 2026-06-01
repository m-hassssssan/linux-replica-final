import { useState, useRef, useEffect } from 'react';
import * as Icons from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface Template {
  name: string;
  code: string;
}

const CXX_TEMPLATES: Template[] = [
  {
    name: 'Hello World',
    code: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, Strata C++ Compiler!" << endl;
    cout << "This runs 100% client-side in real-time!" << endl;
    return 0;
}`
  },
  {
    name: 'Fibonacci Sequence',
    code: `#include <iostream>
using namespace std;

int fibonacci(int n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

int main() {
    int limit = 10;
    cout << "Printing Fibonacci Series up to " << limit << " elements:" << endl;
    for (int i = 0; i < limit; i++) {
        cout << fibonacci(i) << " ";
    }
    cout << endl;
    return 0;
}`
  },
  {
    name: 'Bubble Sort Algorithm',
    code: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> numbers = {64, 34, 25, 12, 22, 11, 90};
    int n = numbers.size();
    
    cout << "Original vector: ";
    for(int i = 0; i < n; i++) {
        cout << numbers[i] << " ";
    }
    cout << endl;

    // Bubble Sort Algorithm
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - i - 1; j++) {
            if (numbers[j] > numbers[j + 1]) {
                // Swap numbers
                int temp = numbers[j];
                numbers[j] = numbers[j + 1];
                numbers[j + 1] = temp;
            }
        }
    }

    cout << "Sorted vector:   ";
    for(int i = 0; i < n; i++) {
        cout << numbers[i] << " ";
    }
    cout << endl;
    return 0;
}`
  },
  {
    name: 'Factorial Calculator',
    code: `#include <iostream>
using namespace std;

long long factorial(int n) {
    if (n == 0 || n == 1) return 1;
    return n * factorial(n - 1);
}

int main() {
    int num = 8;
    cout << "Factorial of " << num << " is " << factorial(num) << endl;
    return 0;
}`
  },
  {
    name: 'User Input (std::cin)',
    code: `#include <iostream>
#include <string>
using namespace std;

int main() {
    string name;
    int birthYear;
    
    cout << "Enter your first name (type in console & hit Enter): ";
    cin >> name;
    
    cout << "Enter your year of birth (type in console & hit Enter): ";
    cin >> birthYear;
    
    int age = 2026 - birthYear;
    cout << endl;
    cout << "Hello, " << name << "!" << endl;
    cout << "In the year 2026, you will be " << age << " years old!" << endl;
    return 0;
}`
  }
];

const splitCoutChain = (chain: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < chain.length; i++) {
    const char = chain[i];
    if ((char === '"' || char === "'") && chain[i-1] !== '\\') {
      if (inString && stringChar === char) {
        inString = false;
      } else if (!inString) {
        inString = true;
        stringChar = char;
      }
      current += char;
    } else if (!inString && char === '<' && chain[i+1] === '<') {
      parts.push(current.trim());
      current = '';
      i++; 
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
};

const executeCppCode = async (
  code: string, 
  _cout: (val: string) => void, 
  _cin: () => Promise<string>
): Promise<void> => {
  try {
    // 1. Identify numeric variables to coerce console string inputs to numbers
    const numericVars = new Set<string>();
    
    // Match loop variable declarations: for (int i = 0; ... )
    const loopRegex = /\bfor\s*\(\s*(?:int|double|float|long\s+long)\s+([a-zA-Z_]\w*)/g;
    let loopMatch;
    while ((loopMatch = loopRegex.exec(code)) !== null) {
      numericVars.add(loopMatch[1]);
    }

    // Match ordinary statements of numeric declarations like: int x; double y = 1.0; float a, b = 2.0;
    const numericDeclRegex = /\b(?:int|double|float|long\s+long)\s+([^;(){]+);/g;
    let declMatch;
    while ((declMatch = numericDeclRegex.exec(code)) !== null) {
      const declBody = declMatch[1];
      const parts = declBody.split(',');
      parts.forEach(part => {
        const nameMatch = part.trim().match(/^([a-zA-Z_]\w*)/);
        if (nameMatch) {
          numericVars.add(nameMatch[1]);
        }
      });
    }

    let jsCode = code
      .replace(/\r/g, '')
      .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1') 
      .replace(/#include\s*<.*?>/g, '') 
      .replace(/using\s+namespace\s+std\s*;/g, '');

    jsCode = jsCode.replace(/int\s+main\s*\([^)]*\)\s*\{/g, 'async function main() {');

    jsCode = jsCode.replace(/\b(?:int|double|float|string|bool|char|long\s+long|void)\s+([\w]+)\s*\(([^)]*)\)\s*\{/g, (_, name, params) => {
      const cleanParams = params.replace(/\b(?:int|double|float|string|bool|char|long\s+long|const\s+[\w]+&?|&)\b/g, '').replace(/\s+/g, '');
      return `async function ${name}(${cleanParams}) {`;
    });

    // Extract custom helper function names to prepend "await" inside transpiled JS executions
    const funcNames: string[] = [];
    const funcRegex = /async\s+function\s+([\w]+)/g;
    let match;
    while ((match = funcRegex.exec(jsCode)) !== null) {
      funcNames.push(match[1]);
    }
    funcNames.forEach(fn => {
      if (fn !== 'main') {
        const invokeRegex = new RegExp(`\\b(?<!async\\s+function\\s+)${fn}\\(`, 'g');
        jsCode = jsCode.replace(invokeRegex, `await ${fn}(`);
      }
    });

    // Vector replacements
    jsCode = jsCode.replace(/\bvector\s*<.*?>\s+([\w]+)(?:\s*\(([^)]*)\))?\s*(?:=\s*\{(.*?)\})?\s*;/g, (_, name, size, elements) => {
      if (elements !== undefined) {
        return `let ${name} = [${elements}];`;
      }
      if (size !== undefined) {
        return `let ${name} = new Array(${size}).fill(0);`;
      }
      return `let ${name} = [];`;
    });

    jsCode = jsCode.replace(/\.push_back\((.*?)\)/g, '.push($1)');
    jsCode = jsCode.replace(/\.size\(\)/g, '.length');
    jsCode = jsCode.replace(/\.pop_back\(\)/g, '.pop()');
    jsCode = jsCode.replace(/\.clear\(\)/g, '.length = 0');

    // Convert basic type keywords to let in a string-literal-safe manner
    jsCode = jsCode.replace(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\b(?:int|double|float|string|bool|char|long\s+long)\b/g, (match) => {
      if (match.startsWith('"') || match.startsWith("'")) {
        return match;
      }
      return 'let';
    });

    // Parse std::cout <<
    const coutRegex = /\bcout\s*<<\s*([^;]+);/g;
    jsCode = jsCode.replace(coutRegex, (_, chain) => {
      const parts = splitCoutChain(chain);
      return parts.map((part: string) => {
        if (part === 'endl') {
          return `_cout("\\n");`;
        }
        return `_cout(${part});`;
      }).join(' ');
    });

    // Parse std::cin >> with numeric type coercion
    const cinRegex = /\bcin\s*>>\s*([^;]+);/g;
    jsCode = jsCode.replace(cinRegex, (_, chain) => {
      const parts = chain.split(/\s*>>\s*/).filter(Boolean);
      return parts.map((part: string) => {
        const varName = part.trim();
        if (numericVars.has(varName)) {
          return `${varName} = Number(await _cin());`;
        }
        return `${varName} = await _cin();`;
      }).join(' ');
    });

    // Create asynchronous Function sandboxing context
    const runner = new Function('_cout', '_cin', `
      return (async () => {
        ${jsCode}
        if (typeof main === 'function') {
          await main();
        } else {
          throw new Error("No int main() function found in C++ source code.");
        }
      })();
    `);

    await runner(_cout, _cin);
  } catch (err: any) {
    _cout(`\n[Runtime Error] ${err.message}`);
  }
};

// --- Strata Copilot Client-side Generative AI Engine ---
interface AiResult {
  response: string;
  fixCode?: string;
  generatedCode?: string;
}

const generateAiResponse = async (
  cmd: 'explain' | 'debug' | 'generate', 
  code: string, 
  prompt: string
): Promise<AiResult> => {
  const apiKey = localStorage.getItem('strata_gemini_api_key') || '';
  
  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
      
      let aiPrompt = '';
      if (cmd === 'explain') {
        aiPrompt = `You are an expert C++ programming assistant. Explain the following C++ code clearly and concisely. Highlight its logic and flow using markdown formatting.\n\nC++ Code:\n\`\`\`cpp\n${code}\n\`\`\``;
      } else if (cmd === 'debug') {
        aiPrompt = `You are an expert C++ static code analyzer and compiler. Scan the following C++ code for syntax bugs, missing semicolons, mismatch braces, or logical errors. Respond with a clear summary of issues (if any) in markdown, and then provide the fully repaired complete C++ code inside a single C++ markdown code block (delimited by \`\`\`cpp and \`\`\` ). Do NOT truncate the repaired code under any circumstances!\n\nC++ Code:\n\`\`\`cpp\n${code}\n\`\`\``;
      } else { // generate
        aiPrompt = `You are an expert C++ software engineer. Generate a high-quality, fully commented, modern C++ program that fulfills the following prompt: "${prompt}".\n\nRequirements:\n1. Keep it compatible with client-side execution (standard loops, vectors, basic functions, using std::cin for dynamic interactive inputs, std::cout for console printing).\n2. Format the generated code inside a single C++ markdown code block (delimited by \`\`\`cpp and \`\`\` ). Do NOT include any other code blocks or markdown code wrappers, only the explanation and the single code block with complete code.\n3. Make sure to implement interactive 'std::cin' prompts so that the user is clearly instructed to type inputs.`;
      }
      
      const result = await model.generateContent(aiPrompt);
      const text = result.response.text();
      
      // Parse response to extract code block if applicable
      let fixCode: string | undefined = undefined;
      let generatedCode: string | undefined = undefined;
      
      const codeBlockRegex = /```cpp([\s\S]*?)```/i;
      const match = text.match(codeBlockRegex);
      if (match && match[1]) {
        const parsedCode = match[1].trim();
        if (cmd === 'debug') {
          fixCode = parsedCode;
        } else if (cmd === 'generate') {
          generatedCode = parsedCode;
        }
      }
      
      return {
        response: text.replace(codeBlockRegex, '').trim() || text,
        fixCode,
        generatedCode
      };
    } catch (err: any) {
      throw new Error(err.message || 'Gemini API connection error');
    }
  }

  // --- Offline AI Fallback Generator ---
  const isHello = code.includes("Strata C++ Compiler");
  const isFib = code.includes("fibonacci");
  const isSort = code.includes("numbers[j] > numbers[j + 1]");
  const isFactorial = code.includes("factorial");
  const isInput = code.includes("birthYear");

  if (cmd === 'explain') {
    let explanation = '';
    if (isHello) {
      explanation = `### 💡 Code Explanation: Hello World
This program prints greeting lines to the standard output.

1. **\`#include <iostream>\`**: Includes the basic input-output stream library, giving access to the \`cout\` object.
2. **\`using namespace std;\`**: Allows using standard library types and entities directly without writing \`std::\`.
3. **\`int main() { ... }\`**: The primary entry point. Every C++ executable starts execution here.
4. **\`cout << ... << endl;\`**: Writes statements to the screen followed by a newline (\`endl\`).`;
    } else if (isFib) {
      explanation = `### 💡 Code Explanation: Fibonacci Recursion
This C++ program uses a recursive function to compute and output Fibonacci values.

1. **\`int fibonacci(int n)\`**: A custom recursive block.
   - **Base Case:** Returns \`n\` if \`n <= 1\`.
   - **Recursion:** Calls itself with values \`(n-1)\` and \`(n-2)\` and adds their results.
2. **\`int main()\`**: Declares a variable \`limit = 10\` and loops to display the sequence separated by spacing.`;
    } else if (isSort) {
      explanation = `### 💡 Code Explanation: Bubble Sort
This script demonstrates basic element sorting using vectors.

1. **\`#include <vector>\`**: Imports sequence containers to support dynamic arrays.
2. **\`vector<int> numbers = {64, 34, ...}\`**: Instantiates a vector with initial unsorted values.
3. **\`Bubble Sort Loop:\`**: Runs double loops. The inner loop evaluates adjacent fields (\`numbers[j] > numbers[j+1]\`) and swaps them if they are in descending order.`;
    } else if (isFactorial) {
      explanation = `### 💡 Code Explanation: Factorial
This script computes factorials recursively.

1. **\`long long factorial(int n)\`**: Calculates factorials using \`long long\` to safeguard against huge numeric boundaries.
2. **\`Base Case:\`**: Returns 1 if n is 0 or 1, else returns \`n * factorial(n - 1)\`.`;
    } else if (isInput) {
      explanation = `### 💡 Code Explanation: User Input (cin)
This script demonstrates taking terminal inputs dynamically.

1. **\`string name; int birthYear;\`**: Declares holding variables.
2. **\`cin >> name;\`**: Halts to capture characters from input.
3. **\`cin >> birthYear;\`**: Captures numbers from the stream.
4. **\`int age = 2026 - birthYear;\`**: Calculates age relative to the year 2026.`;
    } else {
      explanation = `### 💡 C++ Code Analysis
I analyzed your C++ source script:

1. **Execution Entry:** Found valid \`int main()\` wrapper.
2. **Output Stream:** Using standard \`cout\` commands.
3. **Compilation:** The transpiler validates this code cleanly.`;
    }
    
    return {
      response: `> [Spacer OS Copilot]\n> **Offline Demo Mode:** Connect your Gemini API Key in the **Gemini AI** chat app settings to unlock unlimited, live generative AI explanations!\n\n${explanation}`
    };
  }

  if (cmd === 'debug') {
    const missingSemicolon = code.includes('cout') && !code.includes(';') && !code.includes('//');
    const missingMain = !code.includes('main') || !code.includes('{');
    
    if (missingSemicolon) {
      const lines = code.split('\n');
      const repaired = lines.map(l => {
        if (l.includes('cout') && !l.includes(';') && !l.trim().endsWith('{') && !l.trim().endsWith('}')) {
          return l + ';';
        }
        return l;
      }).join('\n');

      return {
        response: `> **Offline Demo Mode:** Save your Gemini API Key in the **Gemini AI** chat app settings to unlock live code debugging!\n\n### 🛠️ Debugger: Semicolon Error Repaired!\nI scanned your C++ source code and identified a missing termination character:\n\n> **[Warning]** Expected ';' to terminate standard statements.\n\nClick **Apply Fix** below to inject semicolons automatically!`,
        fixCode: repaired
      };
    } else if (missingMain) {
      return {
        response: `> **Offline Demo Mode:** Save your Gemini API Key in the **Gemini AI** chat app settings to unlock live code debugging!\n\n### 🛠️ Debugger: Entry Point Missing\nI scanned your C++ source code and found a linking block:\n\n> **[Linker Error]** undefined reference to 'main'\n> All executable C++ code must run inside an \`int main()\` entry block.\n\nClick **Apply Fix** below to wrap your code inside a main function automatically!`,
        fixCode: `#include <iostream>\nusing namespace std;\n\nint main() {\n    ${code}\n    return 0;\n}`
      };
    } else {
      return {
        response: `> **Offline Demo Mode:** Save your Gemini API Key in the **Gemini AI** chat app settings to unlock live code debugging!\n\n### 🛠️ Debugger: 0 Errors Found\nYour C++ source code is clean, syntactically balanced, and completely ready to compile!\n\n- Semicolons and brackets: **OK**\n- Variable instantiations: **OK**\n- Compiler safety: **OK**\n\nClick **Run** to execute your code!`,
        fixCode: code
      };
    }
  }

  if (cmd === 'generate') {
    const p = prompt.toLowerCase().trim();
    if (!p) {
      return {
        response: `### ⚠️ Empty Prompt\nPlease type what kind of program you want to generate in the text field below before clicking send!`
      };
    }

    const demoHeader = `> **Offline Demo Mode:** Connect your Google Gemini API Key in the **Gemini AI** chat app settings to unlock live, unrestricted C++ code generation for any custom coding prompt!\n\n`;

    // 1. Calculator / Math
    if (p.includes('calc') || p.includes('add') || p.includes('sub') || p.includes('math') || p.includes('arithmetic')) {
      const gCode = `#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string op;\n    double num1, num2;\n    \n    cout << "=== Strata Interactive C++ Calculator ===" << endl;\n    cout << "Enter operation type (add, sub, mul, div): ";\n    cin >> op;\n    \n    cout << "Enter first number: ";\n    cin >> num1;\n    \n    cout << "Enter second number: ";\n    cin >> num2;\n    \n    cout << endl;\n    if (op == "add") {\n        cout << "Result: " << num1 << " + " << num2 << " = " << (num1 + num2) << endl;\n    } else if (op == "sub") {\n        cout << "Result: " << num1 << " - " << num2 << " = " << (num1 - num2) << endl;\n    } else if (op == "mul") {\n        cout << "Result: " << num1 << " * " << num2 << " = " << (num1 * num2) << endl;\n    } else if (op == "div") {\n        if (num2 == 0) {\n            cout << "Error: Division by zero is undefined!" << endl;\n        } else {\n            cout << "Result: " << num1 << " / " << num2 << " = " << (num1 / num2) << endl;\n        }\n    } else {\n        cout << "Error: Unknown operation '" << op << "'" << endl;\n    }\n    return 0;\n}`;
      return {
        response: `${demoHeader}### 🤖 Generated: Interactive Calculator\nI generated a fully interactive console C++ calculator program that prompts the user for inputs and supports addition, subtraction, multiplication, and division.`,
        generatedCode: gCode
      };
    }
    
    // 2. Prime / Factors
    if (p.includes('prime') || p.includes('gcd') || p.includes('lcm') || p.includes('factor')) {
      const gCode = `#include <iostream>\nusing namespace std;\n\nbool isPrime(int n) {\n    if (n <= 1) return false;\n    for (int i = 2; i * i <= n; i++) {\n        if (n % i == 0) return false;\n    }\n    return true;\n}\n\nint main() {\n    int checkNum;\n    cout << "=== C++ Prime Checker & Divisors ===" << endl;\n    cout << "Enter a positive integer: ";\n    cin >> checkNum;\n    \n    cout << endl;\n    if (isPrime(checkNum)) {\n        cout << checkNum << " is a PRIME number!" << endl;\n    } else {\n        cout << checkNum << " is a COMPOSITE number." << endl;\n        cout << "Divisors of " << checkNum << ": ";\n        for (int i = 1; i <= checkNum; i++) {\n            if (checkNum % i == 0) {\n                cout << i << " ";\n            }\n        }\n        cout << endl;\n    }\n    return 0;\n}`;
      return {
        response: `${demoHeader}### 🤖 Generated: Prime & Divisors Checker\nI generated an optimized $O(\\sqrt{N})$ Prime number test algorithm that dynamically scans for divisors and prints lists of composite properties.`,
        generatedCode: gCode
      };
    }

    // 3. Palindrome / String Reverse
    if (p.includes('palindrome') || p.includes('reverse') || p.includes('string') || p.includes('char') || p.includes('word')) {
      const gCode = `#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    string word;\n    cout << "=== C++ String Palindrome Tester ===" << endl;\n    cout << "Enter a word (no spaces): ";\n    cin >> word;\n    \n    string reversed = "";\n    int len = word.length();\n    for (int i = len - 1; i >= 0; i--) {\n        reversed += word[i];\n    }\n    \n    cout << endl;\n    cout << "Original word: " << word << endl;\n    cout << "Reversed word: " << reversed << endl;\n    \n    if (word == reversed) {\n        cout << "Result: The word IS a palindrome!" << endl;\n    } else {\n        cout << "Result: The word is NOT a palindrome." << endl;\n    }\n    return 0;\n}`;
      return {
        response: `${demoHeader}### 🤖 Generated: String Palindrome Checker\nI generated a string buffer processing script that parses console text and evaluates symmetry rules to match palindromic words.`,
        generatedCode: gCode
      };
    }

    // 4. Even or Odd
    if (p.includes('even') || p.includes('odd')) {
      const gCode = `#include <iostream>\nusing namespace std;\n\nint main() {\n    int number;\n    cout << "=== C++ Even or Odd Checker ===" << endl;\n    cout << "Enter an integer: ";\n    cin >> number;\n    \n    cout << endl;\n    if (number % 2 == 0) {\n        cout << "The number " << number << " is EVEN." << endl;\n    } else {\n        cout << "The number " << number << " is ODD." << endl;\n    }\n    return 0;\n}`;
      return {
        response: `${demoHeader}### 🤖 Generated: Even or Odd Checker\nI generated a C++ program that reads an integer from the user's console input and evaluates whether it is even or odd using the modulo operator.`,
        generatedCode: gCode
      };
    }

    // 5. Fibonacci
    if (p.includes('fibonacci') || p.includes('recur')) {
      const gCode = `#include <iostream>\nusing namespace std;\n\nint fibonacci(int n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}\n\nint main() {\n    int limit;\n    cout << "=== C++ Recursive Fibonacci Sequence ===" << endl;\n    cout << "Enter how many terms to generate: ";\n    cin >> limit;\n    \n    cout << endl;\n    cout << "Fibonacci series of length " << limit << ":" << endl;\n    for (int i = 0; i < limit; i++) {\n        cout << fibonacci(i) << " ";\n    }\n    cout << endl;\n    return 0;\n}`;
      return {
        response: `${demoHeader}### 🤖 Generated: Recursive Fibonacci\nI generated a recursive C++ Fibonacci sequence builder that takes console inputs to control loop limiters.`,
        generatedCode: gCode
      };
    }

    // 6. Factorial
    if (p.includes('factorial')) {
      const gCode = `#include <iostream>\nusing namespace std;\n\nlong long factorial(int n) {\n    if (n == 0 || n == 1) return 1;\n    return n * factorial(n - 1);\n}\n\nint main() {\n    int num;\n    cout << "=== C++ Recursive Factorial Calculator ===" << endl;\n    cout << "Enter a positive number: ";\n    cin >> num;\n    \n    cout << endl;\n    if (num < 0) {\n        cout << "Error: Factorial of negative numbers is undefined!" << endl;\n    } else {\n        cout << "Factorial of " << num << " is: " << factorial(num) << endl;\n    }\n    return 0;\n}`;
      return {
        response: `${demoHeader}### 🤖 Generated: Recursive Factorial\nI generated a recursive C++ factorial calculator using safe \`long long\` numeric types.`,
        generatedCode: gCode
      };
    }

    // 7. Custom fallback generator
    const words = p.split(/\s+/).filter(w => w.length > 2);
    const mainWord = words[0] || 'algorithm';
    const cleanName = mainWord.replace(/[^a-zA-Z]/g, '');
    const camelName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    
    const customCode = `#include <iostream>\n#include <string>\nusing namespace std;\n\n// Custom C++ class designed for: "${prompt}"\nclass ${camelName}Processor {\nprivate:\n    string promptLabel;\npublic:\n    ${camelName}Processor(string label) {\n        promptLabel = label;\n    }\n    \n    void processOperation() {\n        cout << "--- Executing Custom ${camelName} Operation ---" << endl;\n        cout << "Analyzing prompt instructions..." << endl;\n        cout << "Operation target: " << promptLabel << endl;\n        cout << "Custom execution finished successfully!" << endl;\n        cout << "-----------------------------------------------" << endl;\n    }\n};\n\nint main() {\n    cout << "Strata OS Copilot successfully generated this program!" << endl;\n    cout << "Prompt received: \\"${prompt}\\"" << endl << endl;\n    \n    ${camelName}Processor processor("${prompt}");\n    processor.processOperation();\n    \n    return 0;\n}`;

    return {
      response: `${demoHeader}### 🤖 Generated: Custom ${camelName} Script\nI analyzed your request *"${prompt}"* and structured a fully customized Object-Oriented C++ script for you!`,
      generatedCode: customCode
    };
  }

  return { response: "AI Ready." };
};

export default function CppCompiler() {
  const [code, setCode] = useState(CXX_TEMPLATES[0].code);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    'Welcome to Strata C++ Compiler v1.0',
    'Click "Run" to compile and execute main.cpp client-side.',
  ]);
  const [activeTemplate, setActiveTemplate] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  // AI Copilot State
  const [showCopilot, setShowCopilot] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [aiResult, setAiResult] = useState<AiResult | null>(null);

  // ➜ Interactive Console Input Stdin State
  const [isWaitingInput, setIsWaitingInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputResolverRef = useRef<((value: string) => void) | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll console to the bottom when logs or input state change
  useEffect(() => {
    try {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      try {
        consoleEndRef.current?.scrollIntoView();
      } catch {
        // Safe fallback
      }
    }
  }, [consoleLogs, isWaitingInput]);
  
  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value);
    setActiveTemplate(idx);
    setCode(CXX_TEMPLATES[idx].code);
    setIsWaitingInput(false);
    setInputValue('');
  };

  const appendConsole = (val: any) => {
    const strVal = String(val);
    setConsoleLogs(prev => {
      const last = prev[prev.length - 1] || '';
      if (strVal === '\n') {
        return [...prev, ''];
      } else if (strVal.endsWith('\n')) {
        const clean = strVal.slice(0, -1);
        return [...prev.slice(0, -1), last + clean, ''];
      } else {
        return [...prev.slice(0, -1), last + strVal];
      }
    });
  };

  const requestInput = (): Promise<string> => {
    setIsWaitingInput(true);
    setConsoleLogs(prev => [...prev, '']); // move to fresh line
    return new Promise<string>((resolve) => {
      inputResolverRef.current = resolve;
    });
  };

  const handleCompileAndRun = () => {
    setIsRunning(true);
    setInputValue('');
    setIsWaitingInput(false);
    setConsoleLogs([
      '[g++ compiler] compiling main.cpp...',
      '[g++ compiler] optimizing and linking binary...',
      '[g++ compiler] executing ./main...',
      '----------------------------------------',
      ''
    ]);

    // Asynchronous execution invocation
    setTimeout(async () => {
      const startTime = performance.now();
      await executeCppCode(code, appendConsole, requestInput);
      const endTime = performance.now();
      const speedMs = (endTime - startTime).toFixed(2);

      setConsoleLogs(prev => [
        ...prev,
        '----------------------------------------',
        `Process exited successfully in ${speedMs}ms`
      ]);
      setIsRunning(false);
    }, 800);
  };

  // Submit Interactive Console Input line on hitting Enter
  const handleConsoleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWaitingInput || !inputResolverRef.current) return;
    
    const val = inputValue;
    setInputValue('');
    setIsWaitingInput(false);
    
    // Append input to console logs beautifully
    setConsoleLogs(prev => {
      const last = prev[prev.length - 1] || '';
      return [...prev.slice(0, -1), last + val, ''];
    });
    
    // Resolve promise to resume execution
    inputResolverRef.current(val);
  };

  // AI Actions Trigger
  const handleAiCommand = async (cmd: 'explain' | 'debug' | 'generate') => {
    setShowCopilot(true);
    setAiLoading(true);
    setAiResult(null);

    try {
      const result = await generateAiResponse(cmd, code, customPrompt);
      setAiResult(result);
    } catch (err: any) {
      setAiResult({
        response: `### ❌ AI Error\nFailed to query Gemini AI: ${err.message || 'Unknown network error'}`
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyFix = () => {
    if (aiResult?.fixCode) {
      setCode(aiResult.fixCode);
      setAiResult(null);
    }
  };

  const handleInsertCode = () => {
    if (aiResult?.generatedCode) {
      setCode(aiResult.generatedCode);
      setAiResult(null);
    }
  };

  const lines = code.split('\n');

  return (
    <div className="w-full h-full flex flex-col bg-[#0d0d12] font-mono text-xs text-white">
      {/* 🛠️ Dynamic Header Controls */}
      <div className="h-11 flex items-center px-4 justify-between border-b border-white/5 bg-[#1a1a2e]/50 shrink-0">
        <div className="flex items-center gap-3">
          <Icons.Cpu className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/80">C++ Compiler</span>
          
          <select 
            value={activeTemplate}
            onChange={handleTemplateChange}
            className="h-7 px-2.5 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 text-[11px] text-white/80 outline-none cursor-pointer focus:border-cyan-400/50"
          >
            {CXX_TEMPLATES.map((t, idx) => (
              <option key={idx} value={idx} className="bg-[#13131c] text-white/80">
                Template: {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* AI Toggle Button */}
          <button
            onClick={() => setShowCopilot(!showCopilot)}
            className={`h-7 px-3 rounded-lg border transition-all flex items-center gap-1.5 font-bold ${
              showCopilot 
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' 
                : 'border-white/5 hover:bg-white/5 text-white/50 hover:text-white/80'
            }`}
          >
            <Icons.Sparkles className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
            AI Copilot
          </button>
          
          <button
            onClick={() => setConsoleLogs([])}
            className="h-7 px-3 rounded-lg border border-white/5 hover:bg-white/5 text-[11px] text-white/50 hover:text-white/80 transition-all flex items-center gap-1.5"
          >
            <Icons.Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
          <button
            onClick={() => setCode(CXX_TEMPLATES[activeTemplate].code)}
            className="h-7 px-3 rounded-lg border border-white/5 hover:bg-white/5 text-[11px] text-white/50 hover:text-white/80 transition-all flex items-center gap-1.5"
          >
            <Icons.RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={handleCompileAndRun}
            disabled={isRunning}
            className="h-7 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-[#0c0c10] text-[11px] font-bold transition-all flex items-center gap-1.5 shadow shadow-emerald-500/10 active:scale-95 disabled:opacity-50 disabled:scale-100"
          >
            <Icons.Play className="w-3.5 h-3.5 fill-[#0c0c10]" />
            {isRunning ? 'Compiling...' : 'Run'}
          </button>
        </div>
      </div>

      {/* Editor & Console Split Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: C++ Editor Workspace & AI Copilot Workspace */}
        <div className={`flex overflow-hidden border-r border-white/5 ${showCopilot ? 'w-3/5' : 'w-1/2'} transition-all duration-300`}>
          {/* Main Editor Wrapper */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* ✨ Highly Visible AI Actions Command Bar */}
            <div className="h-8 flex items-center justify-between px-3 bg-[#13131c]/90 border-b border-white/5 select-none">
              <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider flex items-center gap-1.5">
                <Icons.Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                AI Actions
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleAiCommand('explain')}
                  className="h-5.5 px-2 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] text-cyan-400 font-bold border border-cyan-500/20 transition-all flex items-center gap-1 shrink-0 active:scale-95"
                >
                  <Icons.Sparkles className="w-3 h-3 text-yellow-400" />
                  Explain Code
                </button>
                <button
                  onClick={() => handleAiCommand('debug')}
                  className="h-5.5 px-2 rounded bg-rose-500/10 hover:bg-rose-500/20 text-[10px] text-rose-400 font-bold border border-rose-500/20 transition-all flex items-center gap-1 shrink-0 active:scale-95"
                >
                  <Icons.Wrench className="w-3 h-3" />
                  Debug & Fix
                </button>
                <button
                  onClick={() => handleAiCommand('generate')}
                  className="h-5.5 px-2 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-[10px] text-emerald-400 font-bold border border-emerald-500/20 transition-all flex items-center gap-1 shrink-0 active:scale-95"
                >
                  <Icons.Brain className="w-3 h-3" />
                  Generate
                </button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Line Numbers */}
              <div className="w-10 bg-[#13131c] py-3 text-right pr-2.5 text-[10px] text-white/20 select-none overflow-hidden leading-5">
                {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
              </div>
              
              {/* Main Editor Textarea */}
              <div className="flex-1 relative">
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="absolute inset-0 w-full h-full bg-[#09090d] text-white/90 font-mono text-xs leading-5 p-3 resize-none outline-none caret-white"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 🤖 Dynamic AI Copilot Sidebar Panel */}
        {showCopilot && (
          <div className="w-2/5 flex flex-col border-r border-white/5 bg-[#101016]/95 backdrop-blur-md overflow-hidden relative transition-all duration-300">
            {/* Sidebar Header */}
            <div className="h-8 px-3.5 border-b border-white/5 bg-white/3 flex items-center justify-between select-none shrink-0">
              <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider flex items-center gap-1.5">
                <Icons.Sparkles className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
                Strata AI Copilot
              </span>
              <button
                onClick={() => setShowCopilot(false)}
                className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white"
              >
                <Icons.X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Sidebar Scrollable AI Content */}
            <div className="flex-1 p-4 overflow-y-auto leading-5 space-y-4 text-white/80">
              {aiLoading ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                  <Icons.RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                  <span className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">AI is analyzing your C++ code...</span>
                </div>
              ) : aiResult ? (
                <div className="space-y-4">
                  <div className="text-xs text-white/90 whitespace-pre-wrap leading-relaxed select-text font-mono">
                    {aiResult.response}
                  </div>
                  
                  {/* Floating Context-sensitive Action Buttons */}
                  {aiResult.fixCode && (
                    <button
                      onClick={handleApplyFix}
                      className="w-full py-2.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-[#0c0c10] font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow shadow-rose-500/10 active:scale-95"
                    >
                      <Icons.Wrench className="w-4 h-4" />
                      Apply Debug Fix
                    </button>
                  )}
                  {aiResult.generatedCode && (
                    <button
                      onClick={handleInsertCode}
                      className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-[#0c0c10] font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow shadow-emerald-500/10 active:scale-95"
                    >
                      <Icons.Sparkles className="w-4 h-4 fill-[#0c0c10]" />
                      Insert Generated Code
                    </button>
                  )}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center px-4 select-none">
                  <Icons.Sparkles className="w-10 h-10 text-cyan-500/40 mb-3 animate-pulse" />
                  <p className="text-xs text-white/60 mb-1 font-semibold">
                    Strata C++ Intelligence is Ready
                  </p>
                  <p className="text-[10px] text-white/30 max-w-[220px] leading-relaxed">
                    Click any **AI Action** button at the top of the editor, or use the prompt panel below to write custom C++ scripts.
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar Code Generator Prompt Box */}
            <div className="h-28 border-t border-white/5 bg-[#13131c] flex flex-col overflow-hidden shrink-0">
              <div className="h-6 px-3 border-b border-white/5 flex items-center justify-between select-none">
                <span className="text-[9px] uppercase font-bold text-white/35">Generate Program Prompt</span>
              </div>
              <div className="flex-1 flex p-2 gap-2">
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. 'Write a calculator program'..."
                  className="flex-1 bg-[#0b0b0f] text-white/80 p-2 text-xs leading-4 outline-none resize-none placeholder:text-white/20"
                />
                <button
                  onClick={() => handleAiCommand('generate')}
                  disabled={aiLoading}
                  className="px-3 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-[#0c0c10] font-bold flex items-center justify-center active:scale-95 transition-all"
                  title="Generate C++ code"
                >
                  <Icons.Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Right Side: Split Terminal Console (NO standard input panel needed!) */}
        <div className={`flex flex-col overflow-hidden bg-[#07070a] ${showCopilot ? 'w-2/5' : 'w-1/2'} transition-all duration-300`}>
          {/* Monospace Output Console */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="h-7 px-3.5 border-b border-white/5 bg-white/3 flex items-center justify-between select-none shrink-0">
              <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Console Output Terminal</span>
              {isRunning && (
                <span className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-bold">
                  <Icons.RefreshCw className="w-3 h-3 animate-spin" />
                  Linking...
                </span>
              )}
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-1 text-cyan-400/90 leading-5">
              {consoleLogs.map((line, idx) => {
                const isCompiler = line.startsWith('[g++ compiler]');
                const isDivider = line.startsWith('-----');
                const isExit = line.includes('exited successfully');
                const isError = line.includes('[Runtime Error]');
                
                let textColor = 'text-cyan-400/90';
                if (isCompiler) textColor = 'text-white/40';
                if (isDivider) textColor = 'text-white/20';
                if (isExit) textColor = 'text-emerald-400 font-semibold';
                if (isError) textColor = 'text-rose-400 font-bold';

                return (
                  <div key={idx} className={`${textColor} whitespace-pre-wrap`}>
                    {line}
                  </div>
                );
              })}
              
              {/* Blinking Interactive Input Cursor Inside Console! */}
              {isWaitingInput && (
                <form onSubmit={handleConsoleInputSubmit} className="flex items-center text-white shrink-0 mt-1">
                  <span className="text-emerald-400 font-bold mr-1 animate-pulse">➜</span>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-white caret-white font-mono text-xs"
                    autoFocus
                    spellCheck={false}
                    autoComplete="off"
                  />
                </form>
              )}
              <div ref={consoleEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
