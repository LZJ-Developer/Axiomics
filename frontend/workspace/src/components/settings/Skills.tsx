import { type ParentComponent } from "solid-js"
import { useLanguage } from "@/context/language"
import { englishT, type Translate } from "@/i18n/fallback"
import SkillsPage from "@/atlas/SkillsPage"
import "./skills.css"

export { skillIconFor, SkillStateBadges } from "@/atlas/SkillsPage"

export const SkillsFrame: ParentComponent<{ t?: Translate }> = (props) => {
  const t = () => props.t ?? englishT
  return (
    <section class="settings-skills" aria-label={t()("settings.skills.frame")}>
      {props.children}
    </section>
  )
}

const Skills = () => {
  const language = useLanguage()
  return (
    <SkillsFrame t={language.t}>
      <SkillsPage embedded />
    </SkillsFrame>
  )
}

export default Skills
