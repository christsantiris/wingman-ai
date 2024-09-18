import { useEffect, useRef } from "react";
import { FaPlay, FaStopCircle } from "react-icons/fa";
import { useAppContext } from "../../context";

interface ChatInputProps {
	onChatSubmitted: (input: string) => void;
	onChatCancelled: () => void;
	loading: boolean;
}

const ChatInput = ({
	loading,
	onChatSubmitted,
	onChatCancelled,
}: ChatInputProps) => {
	const { isLightTheme } = useAppContext();
	const chatInputBox = useRef<any>(null);

	const inputClasses = isLightTheme
		? "bg-white text-black border-slate-300"
		: "bg-stone-800 text-white border-stone-700";

	useEffect(() => {
		chatInputBox.current?.focus();
	}, [chatInputBox]);

	const handleUserInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter") {
			if (e.shiftKey) {
				return;
			}

			const element = e.target as HTMLInputElement;
			const message = element.value;

			if (!message) {
				return;
			}

			e.preventDefault();

			onChatSubmitted(message);

			element.value = "";
		}
	};

	const handleAutoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		e.target.style.height = "auto";
		e.target.style.height = `${e.target.scrollHeight}px`;
	};

	return (
		<div className="flex-basis-50 py-3 flex flex-col items-stretch">
			<div className="relative flex flex-row items-center">
				<div className={`w-full ${inputClasses} relative`}>
					<div className="flex flex-wrap items-center p-2">
						<textarea
							placeholder="Type here to chat with your Wingman."
							ref={chatInputBox}
							onInput={handleAutoGrow}
							tabIndex={0}
							rows={1}
							autoFocus
							className={`flex-grow bg-transparent outline-none resize-none focus:ring-2 focus:ring-stone-600 overflow-hidden h-auto`}
							style={{ minHeight: "36px", outline: "none" }}
							onKeyDown={handleUserInput}
						/>
					</div>
				</div>
				<span className="p-4">
					{!loading && (
						<FaPlay
							size={16}
							role="presentation"
							title="Send message"
							className="cursor-pointer"
							onClick={() =>
								handleUserInput({
									key: "Enter",
									preventDefault: () => {},
									target: chatInputBox.current,
								} as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
							}
						/>
					)}
					{loading && (
						<FaStopCircle
							size={16}
							role="presentation"
							title="Cancel chat"
							className="cursor-pointer"
							onClick={onChatCancelled}
						/>
					)}
				</span>
			</div>
		</div>
	);
};

export { ChatInput };
