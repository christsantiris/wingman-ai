import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { PlanExecuteState } from "../types";
import { buildObjective, loadWingmanRules } from "../utils";
import { NoFilesChangedError } from "../errors";
import {
	HumanMessage,
	SystemMessage,
} from "@langchain/core/messages";
import { FILE_SEPARATOR } from "./common";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { FileMetadata } from "@shared/types/Message";

type CodeResponse = {
	steps: Array<{
		description: string;
		command?: string;
	}>;
	file: {
		path: string;
		code: string;
		markdownLanguage: string;
		changes?: string[];
	};
};

const DELIMITERS = {
	STEPS_START: '===STEPS_START===',
	STEPS_END: '===STEPS_END===',
	STEP_START: '---STEP---',
	STEP_END: '---END_STEP---',
	FILE_START: '===FILE_START===',
	FILE_END: '===FILE_END==='
} as const;

const parseResponse = (response: string): CodeResponse => {
	// Helper to extract content between delimiters
	const extractSection = (start: string, end: string, content: string) => {
		const regex = new RegExp(`${start}\\n([\\s\\S]*?)\\n${end}`);
		const match = content.match(regex);
		return match ? match[1].trim() : '';
	};

	// Parse steps section
	const stepsContent = extractSection(DELIMITERS.STEPS_START, DELIMITERS.STEPS_END, response);
	const steps: CodeResponse['steps'] = [];

	if (stepsContent) {
		// Split into individual steps
		const stepBlocks = stepsContent.split(DELIMITERS.STEP_START)
			.filter(block => block.trim())
			.map(block => block.split(DELIMITERS.STEP_END)[0].trim());

		// Parse each step
		for (const block of stepBlocks) {
			const descMatch = block.match(/Description: (.*?)(?:\nCommand:|$)/s);
			const cmdMatch = block.match(/Command: (.*?)$/s);

			if (descMatch) {
				steps.push({
					description: descMatch[1].trim(),
					command: cmdMatch?.[1].trim()
				});
			}
		}
	}

	// Parse file section
	const fileContent = extractSection(DELIMITERS.FILE_START, DELIMITERS.FILE_END, response);
	const file: CodeResponse['file'] = {
		path: '',
		code: '',
		markdownLanguage: '',
		changes: []
	};

	if (fileContent) {
		// Extract path
		const pathMatch = fileContent.match(/Path: (.*?)(?:\n|$)/);
		if (pathMatch) {
			file.path = pathMatch[1].trim();
		}

		// Extract language
		const langMatch = fileContent.match(/Language: (.*?)(?:\n|$)/);
		if (langMatch) {
			file.markdownLanguage = langMatch[1].trim();
		}

		// Extract code (everything between Code: and Changes:)
		const codeMatch = fileContent.match(/Code:\n([\s\S]*?)(?=\nChanges:|$)/);
		if (codeMatch) {
			file.code = codeMatch[1].trim();
		}

		// Extract changes
		const changesMatch = fileContent.match(/Changes:\n([\s\S]*?)$/);
		if (changesMatch) {
			file.changes = changesMatch[1]
				.split('\n')
				.map(line => line.trim())
				.filter(line => line.startsWith('- '))
				.map(line => line.slice(2));
		}
	}

	return { steps, file };
};

const baseWriterPrompt = `Analyze this text and output XML.
You are a senior software engineer tasked with writing code for a company.
Implement project enhancements for a single file based on the user's objective.
Ensure every modification is fully integrated.
Focus solely on the file in scope, while considering the context of other files for integration purposes.

Output Structure:
1. Steps: Concise guide for manual implementation steps, excluding file changes.
2. File: Modified or created code for the file in scope.

Output Format Example:
===STEPS_START===
---STEP---
Description: Install required dependency
Command: npm install package-name
---END_STEP---
===STEPS_END===

===FILE_START===
Path: /path/to/file
Language: typescript
Code:
// Your actual code here
Changes:
- Added new function
- Updated imports
===FILE_END===

Key Instructions:
1. Process only the file in scope, do not modify a provided file that is not in scope.
2. Use other files as context for integration purposes (import paths, exports, names, etc.).
3. Omit files requiring no changes or just verification.
4. Output only if changes are made to a file or a new one is created.
5. Always use GitHub-flavored markdown for code output.
6. Provide full file paths in the response.
7. Do not perform extraneous changes to files, dig deep and focus on the integration between the files given.

Step Writing Guidelines:
1. Focus on user-centric, actionable steps not covered in code modifications - these would be manual steps the user still needs to take such as installing dependencies.
2. Explicitly mention file names when relevant.
3. Categorize terminal commands in the "command" field.
4. Ensure clarity, conciseness, and no overlap with file changes, for instance if you imported a file in a code change the user does not need to take manual action.
5. Omit steps for testing or code verification unless explicitly required.
6. Do not include new files created in the steps, these are created for the user automatically.
7. If there are no manual steps, simply return an empty array.
8. Do not return steps such as: "No manual steps are required for this change."

Code Writing Guidelines:
1. Focus strictly on the file in scope, ensure file references are relative to this file path.
2. When generating code focus on existing code style, syntax, and structure.
3. Maintain consistency in naming, error handling, and state management.
4. Leverage existing dependencies and ensure correct imports.
5. Provide complete, functional code without placeholders.
6. Update or create documentation as needed.
7. Ensure seamless integration with existing components.
8. Maintain existing functionality in files, do not cause regression bugs. This is critical.
9. Preserve the code's structure, order, comments, and indentation exactly.
10. Do not include any additional text, explanations, placeholders, ellipses, or code fences. Produce fully functional code.
11. Write clear, self-documenting code.
12. Use meaningful variable and function names.
13. Handle edge cases and errors appropriately.
14. Write testable and maintainable code.
15. Follow security best practices.
16. Optimize for performance where appropriate.
17. Use proper error handling and logging.
18. Follow established naming conventions.
19. Document complex logic or algorithms.
20. Write modular, reusable code.
21. When dealing with file imports ensure that default and named exports/imports are handled properly.
22. If there were no changes made, or changes consisted of "verifying" functionality, return an empty "changes" property for the file in scope.

{{rulepack}}

File Handling:
- Process one file at a time.
- Modify or create files relevant to the objective.
- Use any provided file paths as a reference for any new files.
- Omit irrelevant or unchanged files.
- Omit code verification or extraneous changes.
- Provide full, functional code responses.
- Always include the full file path.
- List changes performed on files, if no changes are performed, omit the file.
- Write the best code possible.
- Make sure the code is the absolute best you can produce, make it human readable.

------

{{details}}

------

{{objective}}

{{steps}}

------

{{review}}

------

{{newsteps}}

{{modified}}

{{otherfiles}}

------

Implement required changes for the file in scope to meet the objective.
Ensure the response is properly formatted using the example provided.
Ensure all tags are properly closed and nested.`;

type BuildPromptParams = {
	projectDetails: string;
	objective: string;
	steps: string;
	review: string;
	newSteps: string;
	modifiedFiles: string;
	otherFiles: string;
	rulePack?: string;
};

const buildPrompt = ({
	projectDetails,
	objective,
	steps,
	review,
	newSteps,
	modifiedFiles,
	otherFiles,
	rulePack,
}: BuildPromptParams) => {
	const rulePromptAddition = !rulePack
		? ""
		: `Use the following rules to guide your code writing:
  
${rulePack}`;

	return baseWriterPrompt
		.replace("{{rulepack}}", rulePromptAddition)
		.replace("{{details}}", projectDetails)
		.replace("{{objective}}", objective)
		.replace("{{steps}}", steps)
		.replace("{{review}}", review)
		.replace("{{newsteps}}", newSteps)
		.replace("{{modified}}", modifiedFiles)
		.replace("{{otherfiles}}", otherFiles);
};

export class CodeWriter {
	constructor(
		private readonly chatModel: BaseChatModel,
		private readonly workspace: string
	) { }

	codeWriterStep = async (
		state: PlanExecuteState
	): Promise<Partial<PlanExecuteState>> => {
		const rulePack = loadWingmanRules(this.workspace);
		const objective = buildObjective(state);

		const planningSteps = state.plan?.files
			? `Implementation steps:
- Use these as a guide or starting point.
- Use these to help perform cross file coordination.

Here are the steps per file:

${state.plan.files
				.map(
					(s) => `File:
  
${s.path}

Steps:
- ${s.plan?.join("\n- ")}`
				)
				.join("\n")}`
			: "";

		const reviewComments =
			!state.review?.comments || state.review?.comments?.length === 0
				? ""
				: `Here are comments from a review of your code changes.
Use these comments to refine your code and meet the objective.

${state.review?.comments?.join("\n")}

------`;

		const codeWriter = this.chatModel;

		const files: FileMetadata[] = [];
		const steps: CodeResponse["steps"] = [];
		for (const { path: file, code } of state.plan?.files || [
			{
				path: "BLANK",
				changes: [],
				code: "",
			},
		]) {
			const systemMessage = new SystemMessage({
				content: [
					{
						type: "text",
						cache_control: { type: "ephemeral" },
						text: buildPrompt({
							projectDetails:
								state.projectDetails || "Not available.",
							objective,
							steps: planningSteps,
							review: reviewComments,
							newSteps:
								steps.length === 0
									? ""
									: `Context: Previously Created Manual Steps
            
The following list contains manual steps already created based on previously modified or created files.
Use this information as context for subsequent step process. Do not suggest these again.

${steps.map((s) => `${s.description}\n${s.command}`).join("\n\n")}

------`,
							modifiedFiles:
								files.length === 0
									? ""
									: `Context: Previously Modified/Created Files
    
The following list contains files already processed, along with their changes. 
Use this information as context for subsequent file processing. Do not modify these files again.
Note: Consider dependencies between files.

${files.map(
										(f) => `File:\n${f.path}\n\nChanges:\n${f.changes?.join("\n")}`
									)}

------`,
							otherFiles:
								state.plan?.files
									?.filter((f) => f.path !== file)
									?.map(
										(f) => `${FILE_SEPARATOR}
              
    File:
    ${f.path}
    
    Code:
    ${f.code}`
									)
									.join(`\n\n${FILE_SEPARATOR}\n\n`) || "",
							rulePack,
						}),
					},
				],
			});

			const output = (await codeWriter.invoke([
				systemMessage,
				new HumanMessage({
					content: [
						{
							type: "text",
							text: `Here is the file currently in scope:
            
${file === "BLANK"
									? `The user does not currently have any related files, assume this may be a new project and this is your current working directory: ${this.workspace}`
									: `File:\n${file}\n\nCode:\n${code}`
								}`,
						},
					],
				}),
			]));

			const result = parseResponse(output.content.toString());

			const fileChanged =
				result.file.changes && result.file.changes.length > 0;

			steps.push(...(result.steps ?? []));

			await dispatchCustomEvent("composer-manual-steps", {
				plan: {
					files: state.plan?.files,
					summary: state.plan?.summary,
					steps
				}
			} satisfies Partial<PlanExecuteState>);

			if (!files.some((f) => f.path === result.file.path) && fileChanged) {
				const stateFile = state.plan?.files?.find(f => f.path === result.file.path);

				if (stateFile) {
					stateFile.language = result.file.markdownLanguage;
					stateFile.code = result.file.code;
					stateFile.changes = result.file.changes ?? [];

					files.push(stateFile);
					await dispatchCustomEvent("composer-plan-files", {
						plan: state.plan
					} satisfies Partial<PlanExecuteState>);
				}
			}
		}

		if (files.length === 0) {
			throw new NoFilesChangedError("No files have been changed.");
		}

		const updatedPlan = {
			files,
			summary: state.plan?.summary || '',
			steps
		}

		await dispatchCustomEvent("composer-done", {
			plan: updatedPlan
		} satisfies Partial<PlanExecuteState>);

		return {
			plan: updatedPlan
		} satisfies Partial<PlanExecuteState>;
	};
}